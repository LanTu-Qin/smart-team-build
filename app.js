// app.js
App({
  onLaunch() {
    // 1. 必须先初始化云环境！
    if (!wx.cloud) {
      console.error('基础库过低，请升级至2.2.3以上')
    } else {
      wx.cloud.init({
        env: "cloud1-d8gb9nir3847ec081",
        traceUser: true
      })
    }

    // 2. 云环境初始化好了，再来加载 store（这样就安全了）
    const store = require('./store/index')
    this.store = store

    // 3. 最后执行静默登录逻辑
    this.wechatLogin()
  },

  async wechatLogin() {
    // 你之前的静默登录代码复制到这儿
    try {
      const res = await wx.cloud.callFunction({
        name: 'userApi',
        data: { action: 'wxLogin' }
      })
      if (res.result.code === 0) {
        const userData = res.result.data
        this.store.user.login(userData)
        if (userData.isNew || !userData.profileComplete) {
          wx.navigateTo({
            url: '/subPackages/user/profile_register'
          })
        }
      }
      }
    catch (err) {
      console.error('微信登录失败', err)
    }
  }
})