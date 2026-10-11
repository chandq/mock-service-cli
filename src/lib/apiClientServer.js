require('./apiClient/server')
  .start()
  .catch(error => {
    if (error.code === 'EADDRINUSE') {
      console.error(`API Client 启动失败：端口 ${error.port} 已被占用（EADDRINUSE）。`);
      console.error('请使用 --api-client --port 0 自动分配空闲端口，或通过 --port <端口号> 指定其他端口。');
    } else if (error.code === 'EACCES' || error.code === 'EPERM') {
      console.error(`API Client 启动失败：权限不足（${error.code}），请检查监听端口和临时目录的访问权限。`);
    } else {
      console.error('API Client 启动失败，请检查端口、工作区和认证配置');
    }
    process.exitCode = 1;
  });
