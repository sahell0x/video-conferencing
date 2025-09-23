import React, { useState, useEffect, useCallback } from 'react';
import { 
  LiveKitRoom, 
  VideoConference, 
  RoomAudioRenderer,
  ControlBar,
  GridLayout,
  ParticipantTile,
  useTracks,
  useParticipants,
  useRoomContext,
  TrackToggle
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track, RoomEvent, VideoPresets, createLocalScreenTracks } from 'livekit-client';
import { Mic, MicOff, Video, VideoOff, Monitor, MonitorOff, PhoneOff, Copy, Check, Users, Loader2 } from 'lucide-react';

const API_URL = 'https://meet-service-api.purpleskyinfotech.com';
// const API_URL = 'http://localhost:3001';


function App() {
  const [stage, setStage] = useState('lobby');
  const [roomId, setRoomId] = useState('');
  const [userName, setUserName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [token, setToken] = useState('');
  const [livekitUrl, setLivekitUrl] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const createRoom = async () => {
    if (!userName.trim()) {
      setError('Please enter your name');
      return;
    }
    
    setError('');
    setStage('connecting');
    
    try {
      const response = await fetch(`${API_URL}/api/rooms/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName, roomName })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setRoomId(data.roomId);
        setRoomName(data.roomName);
        setToken(data.token);
        setLivekitUrl(data.url);
        setStage('connected');
      } else {
        setError(data.error || 'Failed to create room');
        setStage('lobby');
      }
    } catch (err) {
      setError('Failed to connect to server');
      setStage('lobby');
    }
  };

  const joinRoom = async () => {
    if (!userName.trim() || !roomId.trim()) {
      setError('Please enter your name and room ID');
      return;
    }
    
    setError('');
    setStage('connecting');
    
    try {
      const response = await fetch(`${API_URL}/api/rooms/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName, roomId })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setRoomId(data.roomId);
        setRoomName(data.roomName);
        setToken(data.token);
        setLivekitUrl(data.url);
        setStage('connected');
      } else {
        setError(data.error || 'Failed to join room');
        setStage('lobby');
      }
    } catch (err) {
      setError('Failed to connect to server');
      setStage('lobby');
    }
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const leaveRoom = () => {
    setStage('lobby');
    setToken('');
    setRoomId('');
    setRoomName('');
    setError('');
  };

  if (stage === 'lobby') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 max-w-md w-full shadow-2xl border border-white/20">
          <h1 className="text-4xl font-bold text-white mb-8 text-center">Video Conference</h1>
          
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}
          
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Your Name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-white/60 transition"
              onKeyPress={(e) => e.key === 'Enter' && (roomId ? joinRoom() : createRoom())}
            />
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/20"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-transparent text-white/60">Create or Join</span>
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Room Name (optional)"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-white/60 transition"
                />
                <button
                  onClick={createRoom}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition transform hover:scale-105 shadow-lg"
                >
                  Create New Room
                </button>
              </div>
              
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/20"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-transparent text-white/60">OR</span>
                </div>
              </div>
              
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Room ID"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-white/60 transition font-mono"
                />
                <button
                  onClick={joinRoom}
                  className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition transform hover:scale-105 shadow-lg"
                >
                  Join Existing Room
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'connecting') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-white animate-spin mx-auto mb-4" />
          <p className="text-white text-xl">Connecting to room...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <LiveKitRoom
        video={true}
        audio={true}
        token={token}
        serverUrl={livekitUrl}
        onDisconnected={leaveRoom}
        data-lk-theme="default"
        style={{ height: '100vh' }}
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-700">
            <div className="flex items-center space-x-4">
              <h2 className="text-white font-semibold">{roomName}</h2>
              <div className="flex items-center space-x-2">
                <span className="text-gray-400 text-sm">Room ID:</span>
                <code className="bg-gray-700 px-2 py-1 rounded text-white font-mono text-sm">{roomId}</code>
                <button
                  onClick={copyRoomId}
                  className="p-1 hover:bg-gray-700 rounded transition"
                  title="Copy Room ID"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>
            <ParticipantCount />
          </div>
          
          {/* Main video area */}
          <div className="flex-1 relative">
            <VideoConference />
          </div>
        </div>
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}

function ParticipantCount() {
  const participants = useParticipants();
  return (
    <div className="flex items-center space-x-2 text-gray-400">
      <Users className="w-4 h-4" />
      <span className="text-sm">{participants.length}</span>
    </div>
  );
}

export default App;