## 发布 npm 包

1. 登录 npm 官网https://www.npmjs.com/，注册账号
2. 本地登录、验证 npm 账号:

```
 npm adduser
 npm whoami
```

3. 初始化 npm 模块，并定义版本号，添加自己的逻辑代码

```
 npm init
```

4. 发布（注意模块名不能和已存在的模块重名, 版本号要唯一）

```
npm publish
```

## 本地调试 node 模块

> 设置本地全局 node 模块

```
npm link
```

## 常见问题

Q: 若本地存在两个或两个以上不同镜像仓库地址，比如公共仓库和私仓，可能发布 npm 包失败

> `npm publish has resulted in error "You need to authorize this machine using npm adduser"`

A: 登录时要标记发布地址的作用域，以区别不同的仓库

```sh
npm login --scope=@starsys --registry=http://x.x.x.x:8081/repository/npm-local/
```
