// cloudfunctions/getFileUrl/index.js
const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  auth: 'ADMIN'  // 关键步骤：使用管理员权限
})

exports.main = async (event, context) => {
  const { fileList } = event // 传入一个 fileID 数组
  try {
    const result = await cloud.getTempFileURL({
      fileList: fileList
    })
    return {
      success: true,
      fileList: result.fileList // 包含 tempFileURL 字段
    }
  } catch (err) {
    return {
      success: false,
      err
    }
  }
}