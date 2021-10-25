const Mock = require('mockjs');
const Random = Mock.Random;
/**
 * @description:  定义结合MockJs生成包含各种数据类型的随机数组的函数
 *  '$前缀的key和@前缀的value代表MockJs随机生成的数据'
 * @param {*} min
 * @param {*} max
 * @param {*} template
 * @return {*} [Array]
 */
const getRandomArr = ({ min, max, template }) => {
  const randomType = type => {
    if (type.startsWith('@')) {
      return Mock.mock(type);
    } else if (type === 'string') {
      return Random.string();
    }
  };
  return new Array(Math.round(Math.random() * (max - min) + min)).fill('').map(() => {
    const newObj = {};
    Object.keys(template).forEach(key => {
      if (key.startsWith('$')) {
        newObj[key.split('$')[1]] = randomType(template[key]);
      } else {
        newObj[key] = template[key];
      }
    });
    return newObj;
  });
};
module.exports = {
  '/mock/api/device/video/camera/': (req, res) => {
    res.json({
      code: 0,
      data: {
        pages: 10,
        records: getRandomArr({
          min: 200,
          max: 200,
          template: {
            camType: 'NORMAL',
            canDelete: true,
            createdAt: '2021-07-21 20:49:08',
            $devId: '@id',
            $devName: '@ctitle',
            driverId: '0958d9ec6c684519afc8a62721044fa1',
            dvrChannel: 1,
            dvrId: '1418024416622362625',
            dvrName: 'title',
            productKey: 'C18553Mn2W8',
            videoStreamAddress: 'rtsp://admin:admin123@192.168.10.90:554/cam/realmonitor?channel=1%26subtype=0',
            videoStreamProtocol: 'RTSP'
          }
        })
      }
      // 'apiList|2-5': [{ id: Mock.mock('@id'), name: Mock.mock('@cname'), apiId: Mock.mock('@id') }]
    });
  }
};
