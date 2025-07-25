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

document.getElementById('start-chat').addEventListener('click', () => {
    document.getElementById('start-chat').style.display = 'none';
    document.getElementById('loading').style.display = 'block';
    socket.emit('join-random');
});

socket.on('matched', (receivedRoom) => {
    room = receivedRoom;
    document.getElementById('loading').style.display = 'none';
    document.getElementById('chat-window').style.display = 'block';

    pc = new RTCPeerConnection({ iceServers });
    dataChannel = pc.createDataChannel('chat');
    dataChannel.onmessage = (e) => displayMessage(e.data, 'remote');

    pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice-candidate', { room, candidate: e.candidate });
    };

    pc.createOffer().then(offer => pc.setLocalDescription(offer).then(() => socket.emit('offer', { room, offer })));
});

socket.on('offer', (offer) => {
    if (!pc) {
        pc = new RTCPeerConnection({ iceServers });
        pc.ondatachannel = (e) => {
            dataChannel = e.channel;
            dataChannel.onmessage = (e) => displayMessage(e.data, 'remote');
        };
    }
    pc.setRemoteDescription(offer).then(() => pc.createAnswer().then(answer => pc.setLocalDescription(answer).then(() => socket.emit('answer', { room, answer }))));
    pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice-candidate', { room, candidate: e.candidate });
    };
});

socket.on('answer', (answer) => pc.setRemoteDescription(answer));

socket.on('ice-candidate', (data) => pc.addIceCandidate(data.candidate));

document.getElementById('send-message').addEventListener('click', () => {
    const msg = document.getElementById('message-input').value;
    if (msg && dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(msg);
        displayMessage(msg, 'local');
        document.getElementById('message-input').value = '';
    }
});

document.getElementById('end-chat').addEventListener('click', () => {
    if (pc) pc.close();
    document.getElementById('chat-window').style.display = 'none';
    document.getElementById('start-chat').style.display = 'inline-block';
    document.getElementById('messages').innerHTML = '';
});

function displayMessage(msg, type) {
    const div = document.createElement('div');
    div.textContent = msg;
    div.classList.add(type === 'local' ? 'local-message' : 'remote-message');
    document.getElementById('messages').appendChild(div);
    document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
}