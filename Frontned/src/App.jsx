import React, { useState, useEffect, useRef, useCallback } from "react";
import io from "socket.io-client";
import { Device } from "mediasoup-client";

// const API_URL = 'http://localhost:3001';
const API_URL = "https://meet-service-api.purpleskyinfotech.com";

function App() {
  const [roomId, setRoomId] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [peers, setPeers] = useState(new Map());
  const [producers, setProducers] = useState(new Map());
  const [consumers, setConsumers] = useState(new Map());
  const [remoteStreams, setRemoteStreams] = useState(new Map());

  // Use refs for values that need to be accessed in event handlers
  const socketRef = useRef(null);
  const deviceRef = useRef(null);
  const localVideoRef = useRef(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);

  // Memoize event handlers to prevent recreation on every render
  const handleJoinedRoom = useCallback((data) => {
    console.log("Joined room", data);
    setIsJoined(true);
    setPeers(new Map());
    // Get existing producers
    if (socketRef.current) {
      socketRef.current.emit("get-producers");
    }
  }, []);

  const handlePeerJoined = useCallback((data) => {
    console.log("Peer joined", data);
    setPeers((prev) =>
      new Map(prev).set(data.peerId, { id: data.peerId, consumers: [] })
    );
  }, []);

  const handlePeerLeft = useCallback((data) => {
    console.log("Peer left", data);

    // Remove all video elements for this peer
    const peerVideoElements = document.querySelectorAll(
      `[id^="video-peer-${data.peerId}"]`
    );
    peerVideoElements.forEach((element) => {
      const stream = element.srcObject;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      element.remove();
    });

    // Clean up remote streams
    setRemoteStreams((prev) => {
      const newStreams = new Map(prev);
      for (const [streamId] of newStreams) {
        if (streamId.includes(data.peerId)) {
          newStreams.delete(streamId);
        }
      }
      return newStreams;
    });

    setPeers((prev) => {
      const newPeers = new Map(prev);
      newPeers.delete(data.peerId);
      return newPeers;
    });
  }, []);

  const createSendTransport = useCallback(async (transportData) => {
    if (!deviceRef.current) {
      console.error("Device not available");
      return;
    }

    const sendTransport = deviceRef.current.createSendTransport({
      id: transportData.transportId,
      iceParameters: transportData.iceParameters,
      iceCandidates: transportData.iceCandidates,
      dtlsParameters: transportData.dtlsParameters,
      iceServers: transportData.iceServers || [],
    });

    sendTransport.on(
      "connect",
      async ({ dtlsParameters }, callback, errback) => {
        try {
          if (socketRef.current) {
            socketRef.current.emit("connect-transport", {
              transportId: sendTransport.id,
              dtlsParameters,
            });
          }
          callback();
        } catch (error) {
          errback(error);
        }
      }
    );

    sendTransport.on("produce", (parameters, callback, errback) => {
      if (socketRef.current) {
        socketRef.current.emit("produce", {
          transportId: sendTransport.id,
          kind: parameters.kind,
          rtpParameters: parameters.rtpParameters,
          appData: parameters.appData,
        });

        socketRef.current.once("produced", (data) => {
          callback({ id: data.producerId });
        });
      }
    });

    sendTransportRef.current = sendTransport;
  }, []);

  const createRecvTransport = useCallback(async (transportData) => {
    if (!deviceRef.current) {
      console.error("Device not available");
      return;
    }

    const recvTransport = deviceRef.current.createRecvTransport({
      id: transportData.transportId,
      iceParameters: transportData.iceParameters,
      iceCandidates: transportData.iceCandidates,
      dtlsParameters: transportData.dtlsParameters,
      iceServers: transportData.iceServers || [],
    });

    recvTransport.on(
      "connect",
      async ({ dtlsParameters }, callback, errback) => {
        try {
          if (socketRef.current) {
            socketRef.current.emit("connect-transport", {
              transportId: recvTransport.id,
              dtlsParameters,
            });
          }
          callback();
        } catch (error) {
          errback(error);
        }
      }
    );

    recvTransportRef.current = recvTransport;
  }, []);

  const handleTransportCreated = useCallback(
    (data) => {
      console.log("Transport created", data);
      if (data.direction === "send") {
        createSendTransport(data);
      } else {
        createRecvTransport(data);
      }
    },
    [createSendTransport, createRecvTransport]
  );

  const consume = useCallback(async (producerId) => {
    if (socketRef.current && recvTransportRef.current && deviceRef.current) {
      socketRef.current.emit("consume", {
        transportId: recvTransportRef.current.id,
        producerId,
        rtpCapabilities: deviceRef.current.rtpCapabilities,
      });
    }
  }, []);

  const handleNewProducer = useCallback(
    async (data) => {
      console.log("New producer", data);
      await consume(data.producerId);
    },
    [consume]
  );

  const handleConsumed = useCallback(async (data) => {
    console.log("Consumed", data);
    const { consumerId, producerId, kind, rtpParameters } = data;

    if (!recvTransportRef.current) {
      console.error("Receive transport not available");
      return;
    }

    try {
      const consumer = await recvTransportRef.current.consume({
        id: consumerId,
        producerId,
        kind,
        rtpParameters,
      });

      setConsumers((prev) => new Map(prev).set(consumerId, consumer));

      // Handle the media stream
      const track = consumer.track;
      console.log("Consumer track:", track.kind, track.id);

      // Group streams by peer
      const streamId = `peer-${producerId.split("-")[0]}`;

      setRemoteStreams((prev) => {
        const newStreams = new Map(prev);
        let stream = newStreams.get(streamId);

        if (!stream) {
          stream = new MediaStream();
          newStreams.set(streamId, stream);
        }

        // Add the track to the stream
        stream.addTrack(track);

        // Create or update video element
        setTimeout(() => {
          let videoElement = document.getElementById(`video-${streamId}`);
          if (!videoElement) {
            videoElement = document.createElement("video");
            videoElement.id = `video-${streamId}`;
            videoElement.autoplay = true;
            videoElement.playsInline = true;
            videoElement.controls = false;
            videoElement.muted = false; // Don't mute remote videos
            videoElement.className =
              "w-full h-32 bg-gray-800 rounded border-2 border-gray-600 object-cover";

            const remoteVideosContainer =
              document.getElementById("remote-videos");
            if (remoteVideosContainer) {
              remoteVideosContainer.appendChild(videoElement);
              console.log("Created video element:", videoElement.id);
            }
          }

          // Set the stream
          videoElement.srcObject = stream;

          // Force play
          videoElement.play().catch((e) => {
            console.log("Video play failed:", e);
          });

          console.log(
            "Set srcObject for:",
            videoElement.id,
            "tracks:",
            stream.getTracks().length
          );
        }, 100);

        return newStreams;
      });

      if (socketRef.current) {
        socketRef.current.emit("resume-consumer", { consumerId });
      }
    } catch (error) {
      console.error("Error consuming:", error);
    }
  }, []);

  const handleProducersList = useCallback(
    (data) => {
      console.log("Producers list", data);
      data.producers.forEach((producer) => {
        consume(producer.producerId);
      });
    },
    [consume]
  );

  const handleConsumerClosed = useCallback((data) => {
    console.log("Consumer closed", data);

    // Find and remove the video element
    const allVideoElements = document.querySelectorAll('[id^="video-peer-"]');
    allVideoElements.forEach((videoElement) => {
      const stream = videoElement.srcObject;
      if (stream) {
        const tracks = stream.getTracks();
        tracks.forEach((track) => {
          if (
            track.id === data.consumerId ||
            track.label.includes(data.consumerId)
          ) {
            track.stop();
            stream.removeTrack(track);
          }
        });

        // If no tracks left, remove the video element
        if (stream.getTracks().length === 0) {
          videoElement.remove();
        }
      }
    });

    setConsumers((prev) => {
      const newConsumers = new Map(prev);
      newConsumers.delete(data.consumerId);
      return newConsumers;
    });
  }, []);

  const handleTransportConnected = useCallback((data) => {
    console.log("Transport connected", data.transportId);
  }, []);

  const handleProduced = useCallback((data) => {
    console.log("Produced", data);
    setProducers((prev) => new Map(prev).set(data.producerId, data));
  }, []);

  const handleConsumerResumed = useCallback((data) => {
    console.log("Consumer resumed", data.consumerId);
  }, []);

  const handleProducerPaused = useCallback((data) => {
    console.log("Producer paused", data);
  }, []);

  const handleProducerResumed = useCallback((data) => {
    console.log("Producer resumed", data);
  }, []);

  useEffect(() => {
    const socketConnection = io(API_URL);
    socketRef.current = socketConnection;

    // Set up event handlers
    socketConnection.on("joined-room", handleJoinedRoom);
    socketConnection.on("peer-joined", handlePeerJoined);
    socketConnection.on("peer-left", handlePeerLeft);
    socketConnection.on("webrtc-transport-created", handleTransportCreated);
    socketConnection.on("transport-connected", handleTransportConnected);
    socketConnection.on("produced", handleProduced);
    socketConnection.on("new-producer", handleNewProducer);
    socketConnection.on("consumed", handleConsumed);
    socketConnection.on("consumer-resumed", handleConsumerResumed);
    socketConnection.on("producer-paused", handleProducerPaused);
    socketConnection.on("producer-resumed", handleProducerResumed);
    socketConnection.on("producers-list", handleProducersList);
    socketConnection.on("consumer-closed", handleConsumerClosed);

    return () => {
      // Clean up on unmount
      if (sendTransportRef.current) {
        sendTransportRef.current.close();
      }
      if (recvTransportRef.current) {
        recvTransportRef.current.close();
      }
      socketConnection.disconnect();
      socketRef.current = null;
    };
  }, [
    handleJoinedRoom,
    handlePeerJoined,
    handlePeerLeft,
    handleTransportCreated,
    handleTransportConnected,
    handleProduced,
    handleNewProducer,
    handleConsumed,
    handleConsumerResumed,
    handleProducerPaused,
    handleProducerResumed,
    handleProducersList,
    handleConsumerClosed,
  ]);

  const createRoom = async () => {
    try {
      const response = await fetch(`${API_URL}/create-room`, {
        method: "POST",
      });
      const data = await response.json();
      setRoomId(data.roomId);
    } catch (error) {
      console.error("Error creating room:", error);
    }
  };

  const joinRoom = async () => {
    if (!roomId || !socketRef.current) return;

    try {
      // Get RTP capabilities
      const response = await fetch(
        `${API_URL}/room/${roomId}/rtp-capabilities`
      );
      if (!response.ok) {
        throw new Error("Room not found");
      }
      const rtpCapabilities = await response.json();

      // Create device
      const newDevice = new Device();
      await newDevice.load({ routerRtpCapabilities: rtpCapabilities });
      deviceRef.current = newDevice;

      // Join room
      socketRef.current.emit("join-room", {
        roomId,
        rtpCapabilities: newDevice.rtpCapabilities,
      });

      // Create transports
      socketRef.current.emit("create-webrtc-transport", {
        roomId,
        direction: "send",
      });
      socketRef.current.emit("create-webrtc-transport", {
        roomId,
        direction: "recv",
      });
    } catch (error) {
      console.error("Error joining room:", error);
      alert("Error joining room: " + error.message);
    }
  };

  const startVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 30 },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Wait for send transport to be ready
      const waitForTransport = () => {
        return new Promise((resolve) => {
          if (sendTransportRef.current) {
            resolve();
          } else {
            setTimeout(() => waitForTransport().then(resolve), 100);
          }
        });
      };

      await waitForTransport();

      // Produce video first
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && sendTransportRef.current) {
        try {
          const videoProducer = await sendTransportRef.current.produce({
            track: videoTrack,
            appData: { mediaType: "camera" },
          });
          console.log("Video producer created:", videoProducer.id);
        } catch (error) {
          console.error("Error producing video:", error);
        }
      }

      // Produce audio
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack && sendTransportRef.current) {
        try {
          const audioProducer = await sendTransportRef.current.produce({
            track: audioTrack,
            appData: { mediaType: "camera" },
          });
          console.log("Audio producer created:", audioProducer.id);
        } catch (error) {
          console.error("Error producing audio:", error);
        }
      }
    } catch (error) {
      console.error("Error starting video:", error);
      alert("Error starting video: " + error.message);
    }
  };

  const stopVideo = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !isVideoEnabled;
        setIsVideoEnabled(!isVideoEnabled);
      }
    }
  };

  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !isAudioEnabled;
        setIsAudioEnabled(!isAudioEnabled);
      }
    }
  };

  const shareScreen = async () => {
    try {
      if (isScreenSharing) {
        // Stop screen sharing
        const videoTrack = localStream?.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.stop();
        }
        await startVideo();
        setIsScreenSharing(false);
      } else {
        // Start screen sharing
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });

        const videoTrack = screenStream.getVideoTracks()[0];
        const audioTrack = localStream ? localStream.getAudioTracks()[0] : null;

        const newStream = new MediaStream();
        newStream.addTrack(videoTrack);
        if (audioTrack) newStream.addTrack(audioTrack);

        setLocalStream(newStream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = newStream;
        }

        if (sendTransportRef.current) {
          const producer = await sendTransportRef.current.produce({
            track: videoTrack,
            appData: { mediaType: "screen" },
          });
          console.log("Screen share producer created:", producer.id);
        }

        videoTrack.onended = () => {
          setIsScreenSharing(false);
          startVideo();
        };

        setIsScreenSharing(true);
      }
    } catch (error) {
      console.error("Error sharing screen:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-center">
          Video Conference
        </h1>

        {!isJoined ? (
          <div className="bg-gray-800 p-6 rounded-lg max-w-md mx-auto">
            <div className="space-y-4">
              <button
                onClick={createRoom}
                className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded"
              >
                Create Room
              </button>

              <div className="text-center">or</div>

              <input
                type="text"
                placeholder="Enter Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600"
              />

              <button
                onClick={joinRoom}
                disabled={!roomId}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-4 py-2 rounded"
              >
                Join Room
              </button>
            </div>

            {roomId && (
              <div className="mt-4 p-3 bg-gray-700 rounded">
                <p className="text-sm">
                  Room ID: <span className="font-mono">{roomId}</span>
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-gray-800 p-4 rounded-lg">
              <p className="mb-4">
                Room ID: <span className="font-mono">{roomId}</span>
              </p>

              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={localStream ? stopVideo : startVideo}
                  className={`px-4 py-2 rounded ${
                    localStream
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-green-600 hover:bg-green-700"
                  }`}
                >
                  {localStream ? "Stop Video" : "Start Video"}
                </button>

                <button
                  onClick={toggleVideo}
                  disabled={!localStream}
                  className={`px-4 py-2 rounded disabled:bg-gray-600 ${
                    isVideoEnabled
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "bg-gray-600"
                  }`}
                >
                  {isVideoEnabled ? "Turn Off Video" : "Turn On Video"}
                </button>

                <button
                  onClick={toggleAudio}
                  disabled={!localStream}
                  className={`px-4 py-2 rounded disabled:bg-gray-600 ${
                    isAudioEnabled
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "bg-red-600"
                  }`}
                >
                  {isAudioEnabled ? "Mute" : "Unmute"}
                </button>

                <button
                  onClick={shareScreen}
                  disabled={!localStream}
                  className={`px-4 py-2 rounded disabled:bg-gray-600 ${
                    isScreenSharing
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-purple-600 hover:bg-purple-700"
                  }`}
                >
                  {isScreenSharing ? "Stop Screen Share" : "Share Screen"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gray-800 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-3">Your Video</h3>
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-64 bg-gray-700 rounded object-cover"
                />
              </div>

              <div className="bg-gray-800 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-3">Remote Videos</h3>
                <div id="remote-videos" className="space-y-2 min-h-[200px]">
                  {remoteStreams.size === 0 && (
                    <div className="text-gray-400 text-center py-8">
                      No remote participants yet
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-gray-800 p-4 rounded-lg">
              <h3 className="text-lg font-semibold mb-3">
                Participants ({peers.size + 1})
              </h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span>You</span>
                </div>
                {Array.from(peers.values()).map((peer) => (
                  <div key={peer.id} className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                    <span>Peer {peer.id.substring(0, 8)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
