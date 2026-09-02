// pages/index/index.js
const store = require('../../store/index.js')

// 报名状态优先级：报名中 > 未开始 > 已结束
const STATUS_PRIORITY = { '报名中': 0, '未开始': 1, '已结束': 2 }

// 赛事等级 -> CSS 类名（wxss 类名用英文，避免中文类名兼容问题）
const LEVEL_KEY_MAP = {
  '国A': 'national-a',
  '国B': 'national-b',
  '省A': 'province-a',
  '省B': 'province-b'
}
const STATUS_KEY_MAP = {
  '报名中': 'ongoing',
  '未开始': 'upcoming',
  '已结束': 'ended'
}
function getLevelKey(level) { return LEVEL_KEY_MAP[level] || 'other' }
function getStatusKey(status) { return STATUS_KEY_MAP[status] || 'other' }

// 筛选组名（wxml data-group 全小写，避免 data-* 大写转小写）-> data 字段名
// 同一组维护两套字段：arr 用于 applyFilter 过滤（数组 includes 判断），
// sel 用于 wxml 中判断某个 tag 是否被选中（数据路径 map[key] 是 wxml 唯一安全的访问方式）
const FILTER_FIELD_MAP = {
  levels: { arr: 'filterLevels', sel: 'filterLevelsSelected' },
  types: { arr: 'filterTypes', sel: 'filterTypesSelected' },
  statuses: { arr: 'filterStatuses', sel: 'filterStatusesSelected' }
}

Page({
  data: {
    list: [],            // 已排序、已附加 computedStatus/levelKey/statusKey 的完整列表
    filteredList: [],    // 筛选后的列表（页面渲染用）
    bannerList: [],
    hasRequests: false,
    isAdmin: false,

    // ----- 折叠筛选 -----
    filterExpanded: false,
    // 数组字段用于 applyFilter 过滤
    filterLevels: [],    // 多选，空数组表示"全部"
    filterTypes: [],
    filterStatuses: [],
    // 对象字段用于 wxml 渲染选中状态（wxml 不支持 indexOf/includes，只能 map[key] 访问）
    filterLevelsSelected: {},   // { '国A': true, '国B': true }
    filterTypesSelected: {},
    filterStatusesSelected: {},
    levelOptions: [
      { label: '国A', value: '国A' },
      { label: '国B', value: '国B' },
      { label: '省A', value: '省A' },
      { label: '省B', value: '省B' }
    ],
    typeOptions: [
      { label: '个人', value: '个人' },
      { label: '团体', value: '团体' },
      { label: '个人/团体', value: '个人/团体' }
    ],
    statusOptions: [
      { label: '报名中', value: '报名中' },
      { label: '未开始', value: '未开始' },
      { label: '已结束', value: '已结束' }
    ]
  },

  async onLoad() {
    // 1. 加载数据
    await Promise.all([
      store.competition.loadCompetition(),
      store.skills.loadSkills(),
      store.teams.loadAllTeams(),
      store.user.loadUser()
    ])
    // 同步管理员权限到页面 data（控制"赛事管理"按钮显示）
    this.setData({ isAdmin: store.user.state.isAdmin })

    // 初始化页面数据（异步获取 banner）
    await this.initData()

    // 2. 全局监听数据变化，自动刷新页面
    store.subscribe(() => {
      this.initData()
    })

    // 3. 检查是否有未处理的邀请/申请（红点）
    this.checkRequests()
  },

  // 每次回到首页时刷新红点
  onShow() {
    this.setData({ isAdmin: store.user.state.isAdmin })
    this.checkRequests()
  },

  // 查询用户待处理请求数量，决定是否显示红点
  async checkRequests() {
    const userState = store.user.getUserInfo()
    if (!userState.isLogin || !userState.userInfo.uid) {
      this.setData({ hasRequests: false })
      return
    }
    try {
      const uid = userState.userInfo.uid
      const [userRes, captainRes] = await Promise.all([
        wx.cloud.callFunction({ name: 'requestApi', data: { action: 'getByUser', params: { uid } } }),
        wx.cloud.callFunction({ name: 'requestApi', data: { action: 'getByCaptain', params: { uid } } })
      ])
      const personalCount = (userRes.result && userRes.result.code === 0) ? (userRes.result.data || []).length : 0
      const capData = (captainRes.result && captainRes.result.code === 0) ? (captainRes.result.data || {}) : {}
      const captainCount = (capData.invitesSent || []).length + (capData.appliesReceived || []).length
      this.setData({ hasRequests: (personalCount + captainCount) > 0 })
    } catch (err) {
      console.error('查询未读请求失败', err)
      this.setData({ hasRequests: false })
    }
  },

  // 根据开始/结束时间计算真实报名状态（数据库里 status 字段不一定准确）
  computeStatus(start, end) {
    const now = Date.now()
    const s = start ? new Date(start).getTime() : NaN
    const e = end ? new Date(end).getTime() : NaN
    if (!isNaN(s) && now < s) return '未开始'
    if (!isNaN(e) && now > e) return '已结束'
    return '报名中'
  },

  // 计算属性 + 排序 + 应用筛选
  async initData() {
    const rawList = store.competition.getList() || []
    // 1. 给每条赛事附加 computedStatus、levelKey、statusKey
    const enriched = rawList.map(item => {
      const computedStatus = this.computeStatus(item.start, item.end)
      return {
        ...item,
        computedStatus,
        levelKey: getLevelKey(item.level),
        statusKey: getStatusKey(computedStatus)
      }
    })
    // 2. 排序：报名中 > 未开始 > 已结束；同状态按 cid 升序
    enriched.sort((a, b) => {
      const pa = STATUS_PRIORITY[a.computedStatus] ?? 99
      const pb = STATUS_PRIORITY[b.computedStatus] ?? 99
      if (pa !== pb) return pa - pb
      return (a.cid || 0) - (b.cid || 0)
    })
    // 3. 异步获取 banner
    const bannerList = await store.competition.getBanner()
    this.setData({
      list: enriched,
      bannerList: [...bannerList]
    })
    // 4. 应用筛选（更新 filteredList 用于页面渲染）
    this.applyFilter()
  },

  // 根据筛选条件过滤（list 是已排序的完整列表，filteredList 是渲染用列表）
  applyFilter() {
    const { list, filterLevels, filterTypes, filterStatuses } = this.data
    const filtered = list.filter(item => {
      if (filterLevels.length && !filterLevels.includes(item.level)) return false
      if (filterTypes.length && !filterTypes.includes(item.type)) return false
      if (filterStatuses.length && !filterStatuses.includes(item.computedStatus)) return false
      return true
    })
    this.setData({ filteredList: filtered })
  },

  // 展开/收起筛选面板
  toggleFilter() {
    this.setData({ filterExpanded: !this.data.filterExpanded })
  },

  // 切换某个筛选标签（多选；空数组/空 map 表示不过滤 = 默认全部）
  toggleFilterItem(e) {
    const { group, value } = e.currentTarget.dataset
    const map = FILTER_FIELD_MAP[group]
    if (!map) return
    // 同步更新数组 + 对象：数组给 applyFilter 用，对象给 wxml 用（map[key] 是 wxml 唯一安全的访问）
    let arr = [...(this.data[map.arr] || [])]
    let sel = { ...(this.data[map.sel] || {}) }
    const idx = arr.indexOf(value)
    if (idx >= 0) {
      arr.splice(idx, 1)
      delete sel[value]
    } else {
      arr.push(value)
      sel[value] = true
    }
    this.setData({ [map.arr]: arr, [map.sel]: sel })
    this.applyFilter()
  },

  // ---------- 下拉刷新 ----------
  async onPullDownRefresh() {
    console.log("下拉刷新触发")
    try {
      this.setData({ bannerList: [] })

      await store.competition.loadCompetition()
      await store.skills.loadSkills()
      await store.teams.loadAllTeams()
      await store.user.loadUser()

      this.setData({ isAdmin: store.user.state.isAdmin })

      await this.initData()

      wx.showToast({ title: '刷新成功', icon: 'success' })
    } catch (err) {
      console.error('刷新失败', err)
      wx.showToast({ title: '刷新失败', icon: 'none' })
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  // 跳转到赛事详情页
  goToEventDetails(e) {
    const cid = e.currentTarget.dataset.cid
    wx.navigateTo({
      url: `/subPackages/competition/competition_info?cid=${cid}`
    })
  },

  // 跳转至管理页面
  goToAdmin() {
    wx.navigateTo({ url: '/subPackages/admin/admin' })
  },

  // 跳转到 已加入的队伍
  goToJoined() {
    wx.navigateTo({ url: '/subPackages/joined/joined' })
  },

  // 跳转到 新建队伍
  goToCreate() {
    wx.navigateTo({ url: '/subPackages/team/team_push' })
  },

  // 跳转到 寻找队伍
  goToMatch() {
    wx.navigateTo({ url: '/subPackages/team/team_list' })
  },

  // 跳转到 我的
  goToUser() {
    wx.navigateTo({ url: '/subPackages/user/user' })
  }
})