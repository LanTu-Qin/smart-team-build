const app = getApp()
const store = require('../../store/index')
Page({
  data: {
    role: 'student', // 默认学生身份

    // 表单字段（所有角色共用这些字段）
    uid: '',         // 学号 / 工号 / 用户ID
    username: '',    // 真实姓名
    email: '',       // 邮箱（用于队友联系）
    institute: ''    // 学院
  },

  // 切换身份
  switchRole(e) {
    const role = e.currentTarget.dataset.role
    this.setData({ role })
  },

  // 输入框变化
  onChange(e) {
    const field = e.currentTarget.dataset.field
    this.setData({
      [field]: e.detail
    })
  },

  // 根据角色获取验证规则
  getValidationRules() {
    const rules = {
      student: [
        { field: 'uid', label: '学号' },
        { field: 'username', label: '真实姓名' },
        { field: 'email', label: '邮箱' },
        { field: 'institute', label: '学院' }
      ],
      teacher: [
        { field: 'uid', label: '工号' },
        { field: 'username', label: '真实姓名' },
        { field: 'email', label: '邮箱' },
        { field: 'institute', label: '学院' }
      ],
      admin: [
        { field: 'uid', label: '工号' },
        { field: 'username', label: '真实姓名' },
        { field: 'email', label: '邮箱' },
        { field: 'institute', label: '学院' }
      ]
    }
    return rules[this.data.role] || []
  },

  // 提交
  async submitProfile() {
    const { role, uid, username, email, institute } = this.data
    console.log(this.data);

    // 1. 必填验证
    const rules = this.getValidationRules()
    for (const rule of rules) {
      const value = this.data[rule.field]
      if (!value || String(value).trim() === '') {
        wx.showToast({ title: `请填写${rule.label}`, icon: 'none' })
        return
      }
    }

    // 2. 邮箱格式校验（通用邮箱，不限域名）
    if (!/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(email)) {
      wx.showToast({ title: '邮箱格式不正确', icon: 'none' })
      return
    }
    /**
     * 补充学号，工号校验
     */
    wx.showLoading({ title: '保存中...', mask: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'userApi',
        data: {
          action: 'updateProfile',
          params: {
            role,
            uid: String(uid).trim(),
            username: username.trim(),
            email: String(email).trim(),
            institute: institute.trim(),
            profileComplete: true
          }
        }
      })

      wx.hideLoading()

      if (res.result && res.result.code === 0) {
        const updatedUser = res.result.data; // 后端返回的完整用户对象
        app.store.user.login(updatedUser);   // store 负责存储，并同步到需要的缓存
        wx.showToast({ title: '保存成功', icon: 'success' });

        // 返回上一页
        setTimeout(() => {
          wx.navigateBack()
        }, 1200)
      } else {
        wx.showToast({ 
          title: res.result?.msg || '保存失败', 
          icon: 'none' 
        })
      }
    } catch (err) {
      wx.hideLoading()
      console.error('保存失败', err)
      wx.showToast({ title: '网络错误，请重试', icon: 'none' })
    }
  }
})