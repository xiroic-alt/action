// 注册 ESM 解析钩子 (给 node --import 用)
import { register } from 'node:module'
register('./esm-stub.mjs', import.meta.url)
