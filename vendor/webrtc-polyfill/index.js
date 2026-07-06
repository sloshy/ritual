// Stub replacing webrtc-polyfill (and its native node-datachannel dependency).
// ritual only uses TCP/webseed torrent transports; WebRTC peers are never
// created, and the native addon would not survive `bun build --compile`.
class WebRtcUnsupported {
  constructor() {
    throw new Error('WebRTC peers are not supported in this build')
  }
}
export const RTCPeerConnection = WebRtcUnsupported
export const RTCSessionDescription = WebRtcUnsupported
export const RTCIceCandidate = WebRtcUnsupported
export default { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate }
