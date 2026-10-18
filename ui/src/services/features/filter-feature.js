// 功能: 内容过滤 (PiliNara 的推荐流/动态流/评论三路过滤 → 笔上从零实现)
//
// PiliNara 的过滤器是一整套可视化菜单(标题关键词/UP名/分区/时长/播放量/点赞率/已关注豁免,
// 还分"应用到哪些流"). 笔屏放不下那套 UI, 所以这里保留**判定语义**, 把 UI 压成
// "每类流三个输入框(包含/排除/屏蔽UP)" —— 用户仍然能表达同样的规则, 而且能整段粘贴.
//
// 判定函数是纯逻辑 (services/filter-rules.js), 页面只负责在渲染前过一道.
import { defineFeature } from './registry.js'

defineFeature({
  id: 'filter',
  title: '过滤',
  icon: 'set_net',
  spec: {
    ftHome: [true, 'bool'],          // 首页推荐过滤开关
    ftHomeInc: ['', 'str', [512]],   // 首页只保留含这些词的视频 (空 = 不过滤)
    ftHomeExc: ['', 'str', [512]],   // 首页排除含这些词的视频
    ftHomeUp: ['', 'str', [512]],    // 首页屏蔽这些 UP (名字或 mid)
    ftHomeDur: [0, 'int', [0, 7200]],// 首页屏蔽短于 N 秒的视频 (0 = 不过滤)
    ftHomePlay: [0, 'int', [0, 10000000]], // 首页屏蔽播放量低于 N 的视频 (0 = 不过滤)

    ftDyn: [true, 'bool'],           // 动态流过滤
    ftDynExc: ['', 'str', [512]],
    ftDynUp: ['', 'str', [512]],
    ftDynGoods: [true, 'bool'],      // 屏蔽带货动态

    ftCmt: [true, 'bool'],           // 评论过滤
    ftCmtExc: ['', 'str', [512]],    // 评论关键词
    ftCmtUp: ['', 'str', [512]],     // 评论屏蔽用户
    ftCmtLowLevel: [0, 'int', [0, 6]], // 屏蔽等级低于 N 的评论 (0 = 不过滤)
    ftCmtGoods: [true, 'bool'],      // 屏蔽带货评论
    ftCmtUpLikeBypass: [true, 'bool'] // UP 主点赞过的评论豁免
  },
  settings: [
    { k: 'ftHome', t: 'switch', label: '首页推荐过滤', desc: 'PiliNara 同款判定: 关键词 / UP / 时长 / 播放量' },
    { k: 'ftHomeExc', t: 'input', label: '推荐排除词', desc: '逗号或换行分隔, 标题命中即隐藏' },
    { k: 'ftHomeInc', t: 'input', label: '推荐保留词', desc: '非空时只显示命中这些词的视频' },
    { k: 'ftHomeUp', t: 'input', label: '推荐屏蔽 UP', desc: 'UP 名或 mid, 逗号分隔' },
    { k: 'ftHomeDur', t: 'number', label: '屏蔽过短视频', desc: '短于 N 秒的推荐视频不显示 (0 关闭)', step: 30, fmt: function (v) { return v + 's' } },
    { k: 'ftHomePlay', t: 'number', label: '屏蔽低播放量', desc: '播放量低于 N 的推荐视频不显示 (0 关闭)', step: 1000, fmt: function (v) { return v + ' 播放' } },
    { k: 'ftDyn', t: 'switch', label: '动态流过滤' },
    { k: 'ftDynExc', t: 'input', label: '动态排除词' },
    { k: 'ftDynUp', t: 'input', label: '动态屏蔽 UP' },
    { k: 'ftDynGoods', t: 'switch', label: '屏蔽带货动态' },
    { k: 'ftCmt', t: 'switch', label: '评论过滤' },
    { k: 'ftCmtExc', t: 'input', label: '评论排除词' },
    { k: 'ftCmtUp', t: 'input', label: '评论屏蔽用户' },
    { k: 'ftCmtLowLevel', t: 'number', label: '屏蔽低等级', desc: '等级低于 N 的评论不显示 (0 关闭)', step: 1, fmt: function (v) { return 'Lv' + v } },
    { k: 'ftCmtGoods', t: 'switch', label: '屏蔽带货评论' },
    { k: 'ftCmtUpLikeBypass', t: 'switch', label: 'UP 点赞豁免', desc: 'UP 主点赞/回复过的评论不做关键词过滤' }
  ]
})
