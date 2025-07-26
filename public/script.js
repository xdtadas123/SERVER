const socket = io();
let pc;
let room;
let dataChannel;
let isChannelOpen = false;

const iceServers = [
    { urls: 'stun:openrelay.metered.ca:80' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayprojectsecret' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayprojectsecret' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayprojectsecret' }
];

document.getElementById('start-chat').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('start-chat').style.display = 'none';
    document.getElementById('loading').style.display = 'block';
    socket.emit('join-random');
});

socket.on('matched', ({ room: receivedRoom, initiator }) => {
    room = receivedRoom;
    document.getElementById('loading').style.display = 'none';
    document.getElementById('chat-window').style.display = 'block';
    document.getElementById('send-message').disabled = true;

    pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', { room, candidate: e.candidate });
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log('ICE state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            endChat();
        }
    };

    pc.onconnectionstatechange = () => {
        console.log('Connection state:', pc.connectionState);
        if (pc.connectionState === 'failed') {
            endChat();
        }
    };

    pc.onsignalingstatechange = () => {
        console.log('Signaling state:', pc.signalingState);
    };

    if (initiator) {
        dataChannel = pc.createDataChannel('chat');
        setupDataChannel(dataChannel);
        pc.onnegotiationneeded = () => {
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => socket.emit('offer', { room, offer: pc.localDescription }))
                .catch(console.error);
        };
    } else {
        pc.ondatachannel = (e) => {
            dataChannel = e.channel;
            setupDataChannel(dataChannel);
        };
    }
});

socket.on('offer', (offer) => {
    pc.setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => pc.createAnswer())
        .then(answer => pc.setLocalDescription(answer))
        .then(() => socket.emit('answer', { room, answer: pc.localDescription }))
        .catch(console.error);
});

socket.on('answer', (answer) => {
    pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(console.error);
});

socket.on('ice-candidate', (data) => {
    pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(console.error);
});

socket.on('user-left', () => {
    endChat();
});

function setupDataChannel(channel) {
    channel.onopen = () => {
        console.log('Data channel open');
        isChannelOpen = true;
        document.getElementById('send-message').disabled = false;
    };
    channel.onmessage = (e) => displayMessage(e.data, 'remote');
    channel.onclose = () => {
        console.log('Data channel closed');
        isChannelOpen = false;
        endChat();
    };
    channel.onerror = (e) => console.error('Data channel error:', e);
    // Timeout if not open
    setTimeout(() => {
        if (!isChannelOpen) {
            console.error('Channel open timeout');
            endChat();
        }
    }, 10000); // 10s timeout
}

document.getElementById('send-message').addEventListener('click', () => {
    const msg = document.getElementById('message-input').value.trim();
    if (msg && isChannelOpen) {
        dataChannel.send(msg);
        displayMessage(msg, 'local');
        document.getElementById('message-input').value = '';
    } else {
        console.error('Channel not open or message empty');
    }
});

document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('send-message').click();
    }
});

document.getElementById('end-chat').addEventListener('click', () => {
    socket.emit('leave-room', { room });
    endChat();
});

function endChat() {
    if (pc) {
        pc.close();
        pc = null;
    }
    isChannelOpen = false;
    document.getElementById('chat-window').style.display = 'none';
    document.getElementById('start-chat').style.display = 'inline-block';
    document.getElementById('messages').innerHTML = '';
}