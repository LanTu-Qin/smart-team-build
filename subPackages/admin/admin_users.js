const store = require('../../store/index.js')

Page({
  data: {
    keyword: '',
    list: [],
    loading: false,
    searched: false,
    roleMap: { admin: '管理员', teacher: '教师', student: '学生' }
  },
  onLoad() {
    // 权限兜底：非管理员直接返回
    store.user.loadUser().catch(() => {})
      .then(() => {
        if (!store.user.state.isAdmin) {
          wx.showToast({ title: '无管理员权限', icon: 'none' })
          setTimeout(() => wx.navigateBack(), 800)
        }
      })
  },
  // 输入关键词
  onInput(e) {
    this.setData({ keyword: e.detail.value })
  },
  // 搜索用户（uid 精确 / 用户名模糊）
  async doSearch() {
    const keyword = (this.data.keyword || '').trim()
    if (!keyword) return wx.showToast({ title: '请输入uid或用户名', icon: 'none' })
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'userApi',
        data: { action: 'searchUsers', params: { keyword } }
      })
      const cloudRes = res.result
      if (cloudRes.code === 0) {
        this.setData({ list: cloudRes.data || [], searched: true })
        if (!cloudRes.data || cloudRes.data.length === 0) {
          wx.showToast({ title: '未找到用户', icon: 'none' })
        }
      } else if (cloudRes.code === -403) {
        wx.showToast({ title: '无管理员权限', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 800)
      } else {
        wx.showToast({ title: cloudRes.msg || '搜索失败', icon: 'none' })
      }
    } catch (err) {
      console.error('搜索用户失败', err)
      wx.showToast({ title: '搜索异常', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  // 授予 / 取消管理员权限（不改变 role 身份）
  toggleAdmin(e) {
    if (this.data.loading) return
    const uid = e.currentTarget.dataset.uid
    const item = this.data.list.find(i => i.userInfo && Number(i.userInfo.uid) === Number(uid))
    if (!item) return
    const willGrant = !item.isAdmin
    wx.showModal({
      title: willGrant ? '授予管理员权限' : '取消管理员权限',
      content: `确认${willGrant ? '授予' : '取消'}用户「${item.userInfo.username || '未命名'}」（uid:${uid}）的管理员权限？${willGrant ? '其身份（role）不会改变。' : ''}`,
      confirmColor: willGrant ? '#4f7cff' : '#e64340',
      success: (res) => {
        if (!res.confirm) return
        this.doSetAdmin(uid, willGrant)
      }
    })
  },
  async doSetAdmin(uid, willGrant) {
    this.setData({ loading: true })
    wx.showLoading({ title: '处理中...' })
    try {
      const r = await wx.cloud.callFunction({
        name: 'userApi',
        data: { action: 'setAdmin', params: { uid: Number(uid), isAdmin: willGrant } }
      })
      const cloudRes = r.result
      if (cloudRes.code === 0) {
        wx.showToast({ title: willGrant ? '已授予管理员权限' : '已取消管理员权限' })
        // 本地更新该项状态，避免整表重新搜索
        const list = this.data.list.map(i => {
          if (i.userInfo && Number(i.userInfo.uid) === Number(uid)) {
            return Object.assign({}, i, { isAdmin: willGrant })
          }
          return i
        })
        this.setData({ list })
      } else if (cloudRes.code === -403) {
        wx.showToast({ title: '无管理员权限', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 800)
      } else {
        wx.showToast({ title: cloudRes.msg || '操作失败', icon: 'none' })
      }
    } catch (err) {
      console.error('设置管理员权限失败', err)
      wx.showToast({ title: '操作异常', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ loading: false })
    }
  }
})
