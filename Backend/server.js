const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mediasoup = require('mediasoup');
const cors = require('cors');
const publicIp = require('public-ip');


const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Mediasoup configuration
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
];

let worker;
let rooms = new Map();

// Initialize mediasoup worker
async function createWorker() {
  worker = await mediasoup.createWorker({
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });
  
  console.log('Mediasoup worker created');
  
  worker.on('died', () => {
    console.error('Mediasoup worker died, exiting in 2 seconds...');
    setTimeout(() => process.exit(1), 2000);
  });
}

// Create room
async function createRoom(roomId) {
  const router = await worker.createRouter({ mediaCodecs });
  
  const room = {
    router,
    peers: new Map(),
  };
  
  rooms.set(roomId, room);
  return room;
}

// API Routes
app.post('/create-room', async (req, res) => {
  const roomId = Math.random().toString(36).substr(2, 9);
  await createRoom(roomId);
  res.json({ roomId });
});

app.get('/room/:roomId/rtp-capabilities', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json(room.router.rtpCapabilities);
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join-room', async (data) => {
    const { roomId, rtpCapabilities } = data;
    let room = rooms.get(roomId);
    
    if (!room) {
      room = await createRoom(roomId);
    }
    
    socket.join(roomId);
    socket.roomId = roomId;
    
    const peer = {
      id: socket.id,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    
    room.peers.set(socket.id, peer);
    
    socket.emit('joined-room', {
      peers: Array.from(room.peers.keys()).filter(id => id !== socket.id)
    });
    
    socket.to(roomId).emit('peer-joined', { peerId: socket.id });
  });
  
  socket.on('create-webrtc-transport', async (data) => {
    const { roomId, direction } = data;
    const room = rooms.get(roomId);
    
    if (!room) {
      return socket.emit('error', { message: 'Room not found' });
    }
    
    const transport = await room.router.createWebRtcTransport({
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: await publicIp.v4(),
          // announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1',
        }
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
    
    const peer = room.peers.get(socket.id);
    peer.transports.set(transport.id, transport);
    
    socket.emit('webrtc-transport-created', {
      transportId: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      direction,
    });
    
    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        transport.close();
      }
    });
  });
  
  socket.on('connect-transport', async (data) => {
    const { transportId, dtlsParameters } = data;
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    const peer = room.peers.get(socket.id);
    const transport = peer.transports.get(transportId);
    
    await transport.connect({ dtlsParameters });
    socket.emit('transport-connected', { transportId });
  });
  
  socket.on('produce', async (data) => {
    const { transportId, kind, rtpParameters, appData } = data;
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    const peer = room.peers.get(socket.id);
    const transport = peer.transports.get(transportId);
    
    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData,
    });
    
    peer.producers.set(producer.id, producer);
    
    socket.emit('produced', {
      producerId: producer.id,
      kind: producer.kind,
    });
    
    // Notify other peers
    socket.to(roomId).emit('new-producer', {
      peerId: socket.id,
      producerId: producer.id,
      kind: producer.kind,
      appData: producer.appData,
    });
    
    producer.on('transportclose', () => {
      producer.close();
      peer.producers.delete(producer.id);
    });
  });
  
  socket.on('consume', async (data) => {
    const { transportId, producerId, rtpCapabilities } = data;
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    const peer = room.peers.get(socket.id);
    const transport = peer.transports.get(transportId);
    
    const producer = getProducerById(room, producerId);
    if (!producer) {
      return socket.emit('error', { message: 'Producer not found' });
    }
    
    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      return socket.emit('error', { message: 'Cannot consume' });
    }
    
    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });
    
    peer.consumers.set(consumer.id, consumer);
    
    socket.emit('consumed', {
      consumerId: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused,
    });
    
    consumer.on('transportclose', () => {
      peer.consumers.delete(consumer.id);
    });
    
    consumer.on('producerclose', () => {
      peer.consumers.delete(consumer.id);
      socket.emit('consumer-closed', { consumerId: consumer.id });
    });
  });
  
  socket.on('resume-consumer', async (data) => {
    const { consumerId } = data;
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    const peer = room.peers.get(socket.id);
    const consumer = peer.consumers.get(consumerId);
    
    await consumer.resume();
    socket.emit('consumer-resumed', { consumerId });
  });
  
  socket.on('pause-producer', async (data) => {
    const { producerId } = data;
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    const peer = room.peers.get(socket.id);
    const producer = peer.producers.get(producerId);
    
    if (producer) {
      await producer.pause();
      socket.to(roomId).emit('producer-paused', { peerId: socket.id, producerId });
    }
  });
  
  socket.on('resume-producer', async (data) => {
    const { producerId } = data;
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    const peer = room.peers.get(socket.id);
    const producer = peer.producers.get(producerId);
    
    if (producer) {
      await producer.resume();
      socket.to(roomId).emit('producer-resumed', { peerId: socket.id, producerId });
    }
  });
  
  socket.on('get-producers', () => {
    const roomId = socket.roomId;
    const room = rooms.get(roomId);
    const producers = [];
    
    room.peers.forEach((peer, peerId) => {
      if (peerId !== socket.id) {
        peer.producers.forEach((producer) => {
          producers.push({
            peerId,
            producerId: producer.id,
            kind: producer.kind,
            appData: producer.appData,
          });
        });
      }
    });
    
    socket.emit('producers-list', { producers });
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    const roomId = socket.roomId;
    
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const peer = room.peers.get(socket.id);
        if (peer) {
          // Close all transports
          peer.transports.forEach((transport) => {
            transport.close();
          });
          
          room.peers.delete(socket.id);
          socket.to(roomId).emit('peer-left', { peerId: socket.id });
          
          // Clean up empty rooms
          if (room.peers.size === 0) {
            room.router.close();
            rooms.delete(roomId);
          }
        }
      }
    }
  });
});

function getProducerById(room, producerId) {
  for (const peer of room.peers.values()) {
    const producer = peer.producers.get(producerId);
    if (producer) {
      return producer;
    }
  }
  return null;
}

// Start server
async function startServer() {
  await createWorker();
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(console.error);