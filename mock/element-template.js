const Mock = require('mockjs');
module.exports = {
  '/mock/api/getImage': {
    code: 0,
    message: '成功',
    data: {
      url: 'https://cdn.pixabay.com/photo/2021/01/28/21/12/wave-5959087__340.jpg'
    }
  },
  '/mock/api/getRandomText': (req, res) => {
    res.json({
      code: 0,
      message: '成功',
      data: {
        text: Mock.mock('@ctitle')
      }
    });
  }
};
