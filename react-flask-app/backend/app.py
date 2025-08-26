# backend/app.py

import os
import json
import google.generativeai as genai
import PIL.Image
import mysql.connector
import time
from mysql.connector import Error
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.utils import secure_filename

load_dotenv()

app = Flask(__name__)
CORS(app)

# --- Configuration ---
UPLOAD_FOLDER = 'uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# --- Database Connection ---
def get_db_connection():
    try:
        conn = mysql.connector.connect(
            host=os.getenv('DB_HOST'),
            user=os.getenv('DB_USER'),
            password=os.getenv('DB_PASSWORD'),
            database=os.getenv('DB_NAME')
        )
        print("Database connection successful.")
        return conn
    except Error as e:
        print(f"FATAL: Error connecting to MySQL: {e}")
        return None

# --- Gemini AI Model ---
try:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("API key not found in .env file.")
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-1.5-flash-latest")
    print("Generative AI model configured successfully.")
except Exception as e:
    print(f"FATAL: Error configuring Generative AI: {e}")
    exit()

# --- Endpoint to serve uploaded images ---
@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# --- Endpoint to fetch chat history ---
@app.route('/history', methods=['GET'])
def get_history():
    session_id = request.args.get('sessionId')
    print(f"\n--- Request received for /history with sessionId: {session_id} ---")
    if not session_id:
        return jsonify({"error": "Session ID is required"}), 400

    conn = get_db_connection()
    if conn is None:
        return jsonify({"error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor(dictionary=True)
        query = "SELECT sender, message AS text, image_path FROM conversations WHERE session_id = %s ORDER BY timestamp ASC"
        cursor.execute(query, (session_id,))
        history = cursor.fetchall()
        print(f"Found {len(history)} messages for this session.")

        for message in history:
            if message['image_path']:
                filename = os.path.basename(message['image_path'])
                message['image'] = f"{request.host_url.rstrip('/')}uploads/{filename}"
            del message['image_path']

        return jsonify(history)
    except Error as e:
        print(f"DATABASE ERROR in /history: {e}")
        return jsonify({"error": "Could not retrieve history from database."}), 500
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()
            print("Database connection closed for /history.")

# --- Chat Endpoint ---
@app.route('/chat', methods=['POST'])
def handle_chat():
    session_id = request.form.get('sessionId')
    print(f"\n--- Request received for /chat with sessionId: {session_id} ---")
    
    user_message = request.form.get('message', '')
    image_file = request.files.get('file')
    
    if not session_id: return jsonify({"error": "Session ID is missing"}), 400
    if not user_message and not image_file: return jsonify({"error": "No message or file provided"}), 400

    conn = get_db_connection()
    if conn is None: return jsonify({"error": "Database connection failed"}), 500
    
    try:
        cursor = conn.cursor()
        image_path = None
        if image_file:
            filename = secure_filename(image_file.filename)
            unique_filename = f"{session_id}_{int(time.time())}_{filename}"
            image_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
            image_file.save(image_path)
            print(f"Image saved to: {image_path}")

        insert_query = "INSERT INTO conversations (session_id, sender, message, image_path) VALUES (%s, %s, %s, %s)"
        cursor.execute(insert_query, (session_id, 'user', user_message, image_path))
        conn.commit()
        print("User message saved to DB.")

        history_query = "SELECT sender, message FROM conversations WHERE session_id = %s ORDER BY timestamp ASC"
        cursor.execute(history_query, (session_id,))
        db_history = cursor.fetchall()

        # ######################################################################
        # ############# --- START: BOT PERSONA INJECTION --- ###################
        # ######################################################################
        
        # This is the hidden instruction we give to the AI.
        system_prompt = (
            "You are ThatBot, a friendly and helpful AI assistant. "
            "Your goal is to assist users with their questions accurately and politely. "
            "You must never mention that you are a language model or an AI from Google. "
            "You are ThatBot. If this is the user's first real message, start your response by introducing yourself warmly."
        )

        # We create a persona context that the AI will use as its foundation.
        # This is like a "fake" conversation that happened before the user's real one.
        model_context = [
            {'role': 'user', 'parts': [{'text': system_prompt}]},
            {'role': 'model', 'parts': [{'text': "Okay, I understand completely. I am ThatBot, and I am ready to help!"}]},
        ]

        # This is the user's actual conversation history from the database.
        actual_chat_history = [{'role': 'user' if sender == 'user' else 'model', 'parts': [{'text': msg or ""}]} for sender, msg in db_history]
        
        # We combine them: our hidden rules + the real conversation.
        full_history_for_model = model_context + actual_chat_history
        
        # ######################################################################
        # ############## --- END: BOT PERSONA INJECTION --- ####################
        # ######################################################################

        # Start chat with the full history *before* the current message
        chat = model.start_chat(history=full_history_for_model[:-1])
        
        prompt_parts = []
        if image_path:
            prompt_parts.append(PIL.Image.open(image_path))
        if user_message:
            prompt_parts.append(user_message)
        
        response = chat.send_message(prompt_parts)
        bot_reply = response.text
        print("Received reply from Gemini API.")

        cursor.execute(insert_query, (session_id, 'bot', bot_reply, None))
        conn.commit()
        print("Bot reply saved to DB.")
        return jsonify({"reply": bot_reply})

    except Exception as e:
        print(f"ERROR in /chat: {e}")
        return jsonify({"error": f"An error occurred: {e}"}), 500
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()
            print("Database connection closed for /chat.")

if __name__ == '__main__':
    app.run(port=5000, debug=True)