/** Rejects mismatched or headless selections before a manual desktop qualification run. */
const required = process.env.E2E_REQUIRE_QPA_PLATFORM;
const eligible = { linux: ['xcb', 'wayland'], win32: ['windows'], darwin: ['cocoa'] }[process.platform] ?? [];
if (!eligible.includes(required) || process.env.QT_QPA_PLATFORM !== required) {
  throw new Error('Select a real Qt desktop plugin matching the host operating system; headless/offscreen fallback is not permitted');
}
if (required === 'xcb' && !process.env.DISPLAY) throw new Error('X11 qualification requires an active DISPLAY');
if (required === 'wayland' && (!process.env.WAYLAND_DISPLAY || !process.env.XDG_RUNTIME_DIR)) throw new Error('Wayland qualification requires an active WAYLAND_DISPLAY and XDG_RUNTIME_DIR');
process.stdout.write(`Required desktop profile: ${process.platform}/${required}. The verifier also checks the plugin actually loaded by the application.\n`);
