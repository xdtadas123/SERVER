// Client-side logic for robust matching + stable WebRTC text chat
pc.onicecandidate = (e) => {
if (e.candidate) socket.emit('ice-candidate', { room: matchedRoom, candidate: e.candidate });
};
pc.oniceconnectionstatechange = () => {
if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
addMessage('Connection lost. You can start a new chat.', 'system');
teardownWebRTC();
}
};


if (isInitiator) {
dataChannel = pc.createDataChannel('chat', { ordered: true });
wireDataChannel(dataChannel);
pc.onnegotiationneeded = async () => {
try {
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
socket.emit('offer', { room: matchedRoom, offer });
} catch (err) { console.error(err); }
};
} else {
pc.ondatachannel = (e) => wireDataChannel(e.channel);
}
}


function wireDataChannel(channel) {
dataChannel = channel;
channel.onopen = () => {
addMessage('Channel open — say hi!', 'system');
messageInput.disabled = false;
sendBtn.disabled = false;
messageInput.focus();
};
channel.onclose = () => {
addMessage('Channel closed.', 'system');
messageInput.disabled = true; sendBtn.disabled = true;
};
channel.onerror = (e) => {
console.error('DataChannel error', e);
addMessage('Channel error. You can try a new chat.', 'system');
};
channel.onmessage = (e) => addMessage(e.data, 'remote');
}


function teardownWebRTC() {
if (dataChannel) { try { dataChannel.close(); } catch {} }
dataChannel = null;
if (pc) { try { pc.close(); } catch {} }
pc = null;
messageInput.disabled = true; sendBtn.disabled = true;
}


/** COMPOSER **/
composer.addEventListener('submit', (e) => {
e.preventDefault();
const msg = messageInput.value.trim();
if (!msg || !dataChannel || dataChannel.readyState !== 'open') return;
dataChannel.send(msg);
addMessage(msg, 'local');
messageInput.value = '';
});


// Start in a clean idle state
setIdleUI();
messageInput.disabled = true; sendBtn.disabled = true;