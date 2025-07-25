const socket = io();
let pc;
let room;
let dataChannel;

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

socket.on('matched', (receivedRoom) => {
    room = receivedRoom;
    document.getElementById('loading').style.display = 'none';
    document.getElementById('chat-window').style.display = 'block';

    pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', { room, candidate: e.candidate });
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected') {
            endChat();
        }
    };

    dataChannel = pc.createDataChannel('chat');
    setupDataChannel(dataChannel);

    pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => socket.emit('offer', { room, offer: pc.localDescription }))
        .catch(console.error);
});

socket.on('offer', (offer) => {
    pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', { room, candidate: e.candidate });
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected') {
            endChat();
        }
    };

    pc.ondatachannel = (e) => {
        dataChannel = e.channel;
        setupDataChannel(dataChannel);
    };

    pc.setRemoteDescription(offer)
        .then(() => pc.createAnswer())
        .then(answer => pc.setLocalDescription(answer))
        .then(() => socket.emit('answer', { room, answer: pc.localDescription }))
        .catch(console.error);
});

socket.on('answer', (answer) => {
    pc.setRemoteDescription(answer).catch(console.error);
});

socket.on('ice-candidate', (data) => {
    pc.addIceCandidate(data.candidate).catch(console.error);
});

function setupDataChannel(channel) {
    channel.onopen = () => console.log('Data channel open');
    channel.onmessage = (e) => displayMessage(e.data, 'remote');
}

document.getElementById('send-message').addEventListener('click', () => {
    const msg = document.getElementById('message-input').value.trim();
    if (msg && dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(msg);
        displayMessage(msg, 'local');
        document.getElementById('message-input').value = '';
    }
});

document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('send-message').click();
    }
});

document.getElementById('end-chat').addEventListener('click', () => endChat());

function endChat() {
    if (pc) {
        pc.close();
        pc = null;
    }
    document.getElementById('chat-window').style.display = 'none';
    document.getElementById('start-chat').style.display = 'inline-block';
    document.getElementById('messages').innerHTML = '';
    // Optionally, emit disconnect to server if needed
}

function displayMessage(msg, type) {
    const div = document.createElement('div');
    div.textContent = msg;
    div.classList.add(type === 'local' ? 'local-message' : 'remote-message');
    document.getElementById('messages').appendChild(div);
    document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
}