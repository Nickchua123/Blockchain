// Shim for react-qr-scanner when not installed/compatible.
// App does not actually use this component, so return null.
export default function QRReader() {
  return null;
}

