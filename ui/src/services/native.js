// Stable import boundary; the native factory owns one instance per JS context.
// Do not retry a disabled object or turn failures into empty response bodies.
// Context lifetime is fixed in BiliNet.cpp, not by require() cache tricks.
import { bilinet } from 'bilinet'

export { bilinet }
export default bilinet
