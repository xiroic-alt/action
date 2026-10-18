// 原生模块桥 (bilinet) —— 全应用唯一的原生依赖入口
//
// 为什么单独一层: bilinet 是设备侧的 .so (HTTP / 文件 / sqlite / exec), 换机型或固件时
// 只有这一层需要改. 页面与业务模块永远 import 这里, 不直接 import 'bilinet'.
//
// 注意: ES 静态 import 失败会让整个应用起不来 (HANDOVER §3), 所以这里**不做** try/catch import,
// 而是在 env.capabilities() 里做能力探测, 业务按能力降级.
import { bilinet } from 'bilinet'

export { bilinet }
export default bilinet
