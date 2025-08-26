// frontend/src/App.js

import React, { useState, useEffect, useRef } from 'react';
import { FaMicrophone, FaPaperclip, FaPaperPlane } from 'react-icons/fa';
import './App.css';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) {
  recognition.continuous = false;
  recognition.lang = 'en-US';
  recognition.interimResults = false;
}

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  
  // App status to prevent blank page: 'loading', 'ready', 'error'
  const [appStatus, setAppStatus] = useState('loading');

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let currentSessionId = localStorage.getItem('chatSessionId');
    if (!currentSessionId) {
      currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('chatSessionId', currentSessionId);
    }
    setSessionId(currentSessionId);

    const fetchHistory = async (id) => {
      try {
        const response = await fetch(`http://127.0.0.1:5000/history?sessionId=${id}`);
        if (response.ok) {
          const history = await response.json();
          if (history.length > 0) {
            setMessages(history);
          } else {
            setMessages([{ text: "Hello! I am ThatBot. How can I help you?", sender: 'bot' }]);
          }
          setAppStatus('ready');
        } else {
           const err = await response.json();
           throw new Error(err.error || 'Failed to fetch history');
        }
      } catch (error) {
        console.error("Failed to fetch history:", error);
        setAppStatus('error');
      }
    };

    fetchHistory(currentSessionId);
  }, []);

  useEffect(() => {
    if (recognition) {
      recognition.onresult = (event) => setInput(event.results[0][0].transcript);
      recognition.onerror = (event) => console.error("Speech recognition error", event.error);
      recognition.onend = () => setIsListening(false);
    }
  }, []);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleVoiceListen = () => {
    if (!recognition) return alert("Voice recognition is not supported in this browser.");
    if (isListening) {
      recognition.stop();
    } else {
      setInput('');
      recognition.start();
    }
    setIsListening(!isListening);
  };
  
  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
      setFilePreview(URL.createObjectURL(file));
    } else if (file) {
      alert("Please select an image file.");
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSend = async () => {
    const textInput = input.trim();
    if ((textInput === '' && !selectedFile) || !sessionId) return;

    setIsLoading(true);
    const userMessage = { sender: 'user', text: textInput, image: filePreview };
    setMessages(prev => [...prev, userMessage]);
    
    const formData = new FormData();
    formData.append('sessionId', sessionId);
    formData.append('message', textInput);
    if (selectedFile) {
      formData.append('file', selectedFile);
    }

    setInput('');
    removeFile();

    try {
      const response = await fetch('http://127.0.0.1:5000/chat', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Network response was not ok');

      const botMessage = { sender: 'bot', text: data.reply };
      setMessages(prev => [...prev, botMessage]);
    } catch (error) {
      console.error('Error fetching data:', error);
      const errorMessage = { sender: 'bot', text: `Sorry, something went wrong: ${error.message}` };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (appStatus === 'loading') {
    return (
      <div className="App">
        <header className="App-header"><h1>ThatBot</h1></header>
        <div className="status-message">Loading chat history...</div>
      </div>
    );
  }

  if (appStatus === 'error') {
    return (
      <div className="App">
        <header className="App-header"><h1>ThatBot</h1></header>
        <div className="status-message error">
          Failed to connect to the server. Please ensure the backend is running and refresh the page.
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="App-header"><h1>ThatBot</h1></header>
      <div className="chat-window">
        <div className="messages">
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.sender}`}>
              {msg.image && <img src={msg.image} alt="User upload" className="message-image" />}
              {msg.text && <p>{msg.text}</p>}
            </div>
          ))}
          {isLoading && <div className="message bot"><p><i>ThatBot is thinking...</i></p></div>}
          <div ref={messagesEndRef} />
        </div>
        
        {filePreview && (
          <div className="file-preview">
            <img src={filePreview} alt="Preview" />
            <button onClick={removeFile}>&times;</button>
          </div>
        )}

        <div className="input-area">
          <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} accept="image/*" />
          <button className="icon-button" onClick={() => fileInputRef.current.click()} disabled={isLoading}><FaPaperclip /></button>
          {recognition && <button className={`icon-button ${isListening ? 'listening' : ''}`} onClick={handleVoiceListen} disabled={isLoading}><FaMicrophone /></button>}
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyPress} placeholder="Type or speak a message..." disabled={isLoading} rows="1" />
          <button className="send-button" onClick={handleSend} disabled={isLoading || (input.trim() === '' && !selectedFile)}><FaPaperPlane /></button>
        </div>
      </div>
    </div>
  );
}

export default App;