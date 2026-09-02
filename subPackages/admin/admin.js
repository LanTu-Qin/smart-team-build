const store = require('../../store/index.js')
Page({
  data: {
    list: [],
    showModal: false,
    form: {},
    editId: null,
    levels: ['国A', '国B','认定国B','国C', '省A','省B'],
    levelIndex: 0,
    tempImagePath: '',
    imageBase64: '',
    generating: false // AI 生成中，防止重复点击
  },
  onLoad() {
    // 【权限兜底】仅管理员可进入，防止绕过首页入口直接访问
    store.user.loadUser().catch(() => {})
      .then(() => {
        if (!store.user.state.isAdmin) {
          wx.showToast({ title: '无管理员权限', icon: 'none' })
          setTimeout(() => {
            wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) })
          }, 800)
          return
        }
        this.initAdmin()
      })
  },
  initAdmin() {
    // 首页已经拉取云端竞赛，直接读取全局缓存
    this.loadList()
    // 全局监听store数据变化，自动刷新列表
    store.subscribe(() => this.loadList())
  },
  // 仅读取store缓存，不请求云端
  loadList() {
    this.setData({
      list: store.competition.getList()
    })
  },
  showAddModal() {
    this.setData({
      showModal: true,
      editId: null,
      form: {},
      levelIndex: 0,
      tempImagePath: '',
      imageBase64: ''
    })
  },
  editItem(e) {
    const cid = e.currentTarget.dataset.cid
    const item = this.data.list.find(i => i.cid === cid)
    const levelIndex = this.data.levels.findIndex(l => l === item.level)
    this.setData({
      showModal: true,
      editId: cid,
      form: item,
      levelIndex,
      tempImagePath: '',
      imageBase64: ''
    })
  },
  // 选择图片并转为 Base64
  chooseImg() {
    // 替换废弃的 wx.chooseImage → wx.chooseMedia
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'], // 只选择图片
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'], // 压缩图
      success: (res) => {
        // 新版API临时文件路径在 tempFiles[0].tempFilePath
        const tempFilePath = res.tempFiles[0].tempFilePath
        const fileSystem = wx.getFileSystemManager()
        try {
          const base64 = fileSystem.readFileSync(tempFilePath, 'base64')
          // setData异步更新data
          this.setData({
            tempImagePath: tempFilePath,
            imageBase64: base64
          }, () => {
            // setData的第二个回调：数据更新完成后再打印，不会undefined
            console.log("base64-admin");
          })
        } catch (err) {
          wx.showToast({ title: '读取图片失败', icon: 'none' })
          console.error('读取图片失败', err)
        }
      }
    })
  },
  // 删除前二次确认，防止误删
  deleteItem(e) {
    const cid = e.currentTarget.dataset.cid
    const item = this.data.list.find(i => i.cid === cid)
    wx.showModal({
      title: '删除赛事',
      content: `确认删除「${item ? item.name : cid}」？删除后不可恢复`,
      confirmColor: '#e64340',
      success: (res) => {
        if (res.confirm) this.doDelete(cid)
      }
    })
  },
  // 调用云函数删除数据库数据
  async doDelete(cid) {
    wx.showLoading({ title: '删除中...' })
    try {
      // 调用store封装的删除云函数
      await store.competition.deleteComp(cid)
      this.loadList()
      wx.showToast({ title: '删除成功' })
    } catch (err) {
      wx.showToast({ title: '删除失败', icon: 'none' })
      console.error('删除竞赛报错：', err)
    } finally {
      wx.hideLoading()
    }
  },
  // 保存新增/编辑，对接云函数
  async saveItem() {
    const { form, editId, imageBase64 } = this.data
    // 【表单校验】必填项兜底，防止脏数据入库
    if (!form.name || !form.name.trim()) return wx.showToast({ title: '请填写赛事名称', icon: 'none' })
    if (!form.level) return wx.showToast({ title: '请选择赛事等级', icon: 'none' })
    if (!form.type || !form.type.trim()) return wx.showToast({ title: '请填写参赛方式', icon: 'none' })
    if (!form.status || !form.status.trim()) return wx.showToast({ title: '请填写赛事状态', icon: 'none' })
    if (!form.start || !form.start.trim()) return wx.showToast({ title: '请填写开始时间', icon: 'none' })
    if (!form.end || !form.end.trim()) return wx.showToast({ title: '请填写结束时间', icon: 'none' })
    wx.showLoading({ title: '保存中...' })
    try {
      if (editId) {
        // 编辑：传入 compInfo 和图片 Base64（若已选择）
        console.log("即将传入模块,imageBase64:");
        console.log("editId:",editId);
        console.log("form:",form);
        await store.competition.updateComp({ cid: editId, newInfo: form, imageBase64 })
      } else {
        console.log("进入创建");
        console.log(imageBase64.length);
        await store.competition.addComp(form, imageBase64)
      }
      this.loadList()
      this.setData({ showModal: false })
      wx.showToast({ title: '保存成功' })
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' })
      console.error('保存竞赛报错：', err)
    } finally {
      wx.hideLoading()
    }
  },

  // 表单赋值
  setForm(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({
      [`form.${key}`]: e.detail.value
    });
  },
  // 等级选择
  setLevel(e) {
    const idx = e.detail.value
    this.setData({
      levelIndex: idx,
      'form.level': this.data.levels[idx]
    })
  },
  hideModal() {
    this.setData({ showModal: false })
  },
  // 跳转管理员授权页
  goUserAdmin() {
    wx.navigateTo({ url: '/subPackages/admin/admin_users' })
  },
  // 单个赛事 AI 生成详情
  async aiGenDetail(e) {
    if (this.data.generating) return
    const cid = e.currentTarget.dataset.cid
    const item = this.data.list.find(i => i.cid === cid)
    if (!item) return
    this.setData({ generating: true })
    wx.showLoading({ title: 'AI生成中...' })
    try {
      const res = await store.competition.aiGenerateDetail(cid, item.name, item.url || '')
      if (res && res.code === 0) {
        await store.competition.loadCompetition()
        this.loadList()
        wx.showToast({ title: '生成成功' })
      } else {
        wx.showToast({ title: (res && res.msg) || '生成失败', icon: 'none' })
      }
    } catch (err) {
      wx.showToast({ title: '生成异常', icon: 'none' })
      console.error('AI生成详情失败', err)
    } finally {
      wx.hideLoading()
      this.setData({ generating: false })
    }
  },
  // 批量 AI 生成详情（只处理无内容/占位内容的赛事，串行逐个生成）
  batchAiGen() {
    if (this.data.generating) return
    const emptyList = this.data.list.filter(item =>
      !item.content || item.content.includes('这里是赛事详情的写死占位内容')
    )
    if (emptyList.length === 0) {
      wx.showToast({ title: '暂无需要生成的赛事', icon: 'none' })
      return
    }
    wx.showModal({
      title: '批量AI生成',
      content: `将依次生成 ${emptyList.length} 个赛事的详情，每个约需数秒，期间请勿离开页面。是否继续？`,
      confirmColor: '#4f7cff',
      success: (res) => {
        if (!res.confirm) return
        this.runBatchAiGen(emptyList)
      }
    })
  },
  async runBatchAiGen(emptyList) {
    this.setData({ generating: true })
    let ok = 0
    let fail = 0
    for (let i = 0; i < emptyList.length; i++) {
      const item = emptyList[i]
      wx.showLoading({ title: `正在生成 ${i + 1}/${emptyList.length}` })
      try {
        const r = await store.competition.aiGenerateDetail(item.cid, item.name, item.url || '')
        if (r && r.code === 0) ok++
        else fail++
      } catch (err) {
        fail++
        console.error('批量AI生成失败', item.cid, err)
      }
    }
    try { await store.competition.loadCompetition() } catch (e) { console.error(e) }
    this.loadList()
    this.setData({ generating: false })
    wx.hideLoading()
    wx.showModal({
      title: '批量生成完成',
      content: `成功 ${ok} 个，失败 ${fail} 个`,
      showCancel: false
    })
  }
})