/**
 * 内置竞赛信息源预设（纯数据，电脑端与手机端共用）。
 *
 * 放在 shared 是为了让手机端离线也能展示这份订阅清单——手机端现在自己抓，
 * 不需要向电脑要预设列表。
 *
 * 这些是「大学竞赛赛事提醒」功能的一键订阅清单：精选真实、稳定、可被采集链路
 * 解析（RSS 或 HTML 列表页兜底）的竞赛聚合站与官方赛事站。订阅后在后台按各自
 * 间隔自动抓取，赛事通知进「待确认」池，用户确认后生成 DDL。
 *
 * 新增 / 调整预设只需改这里，无需迁移数据库。`url` 必须唯一，是订阅去重与
 * 「是否已订阅」判定的依据。
 */

export interface PresetSourceDef {
  key: string;
  name: string;
  url: string;
  description: string;
  fetchIntervalMinutes: number;
}

export const COMPETITION_PRESETS: PresetSourceDef[] = [
  {
    key: '52jingsai',
    name: '我爱竞赛网 · 赛事列表',
    url: 'https://www.52jingsai.com/bisai/',
    description:
      '聚合各类大学生竞赛的报名通知与截止时间（含报名截止、开考时间），覆盖创业、学科、科技、文艺等赛道。',
    fetchIntervalMinutes: 180,
  },
  {
    key: 'jsjds',
    name: '中国大学生计算机设计大赛',
    url: 'https://jsjds.blcu.edu.cn/',
    description: '4C 官网「大赛焦点 / 大赛动态」，含竞赛方案、省级赛与国赛时间节点、作品提交要求。',
    fetchIntervalMinutes: 360,
  },
  {
    key: 'internet-plus',
    name: '中国「互联网+」大学生创新创业大赛',
    url: 'https://cy.ncss.cn/',
    description: '教育部主办的「互联网+」大赛官网动态与报名通知，覆盖校赛、省赛、国赛各阶段。',
    fetchIntervalMinutes: 720,
  },
  {
    key: 'mcm',
    name: '全国大学生数学建模竞赛',
    url: 'http://www.mcm.edu.cn/',
    description: '高教社承办的全国大学生数学建模竞赛（CUMCM）报名通知、赛题与获奖公示。',
    fetchIntervalMinutes: 720,
  },
  {
    key: 'sdu-online',
    name: '山东大学学生在线 · 通知公示',
    url: 'https://online.sdu.edu.cn/',
    description: '山东大学校级通知与竞赛公示（校级赛事报名、答辩安排、评奖结果），适合本校同学。',
    fetchIntervalMinutes: 360,
  },
];
