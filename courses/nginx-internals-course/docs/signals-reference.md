# 信号与进程控制速查

第 7 章的信号表扩充成运维向速查：谁发、谁收、干什么、常用命令。压测和发版前翻这一页就够。

## 常用信号

| 信号 | 语义 | 收信方 | 常用命令 |
|---|---|---|---|
| TERM | 立即退出（快关） | worker / master | `nginx -s stop` |
| QUIT | 优雅退出：不再接新客，存量连接送完再走 | worker / master | `nginx -s quit` |
| HUP | 重新读配置并平滑换血（reload） | master | `nginx -s reload` |
| USR1 | 重新打开日志文件（日志切割后换新文件写） | master | `nginx -s reopen` |
| USR2 | 热升级：用新二进制启动新 master，继承监听端口 | master | `kill -USR2 <master-pid>` |
| WINCH | 让旧 master 的 worker 优雅退休（配合 USR2 热升级） | master | `kill -WINCH <旧master-pid>` |
| CHLD | 子进程退出通知（内核自动发，master 借此收尸并补招 worker） | master | ——（不用手动发） |
| KILL | 无条件击杀，进程没有机会清理（最后手段） | 任意 | `kill -9 <pid>` |

## 三种关机姿势的区别

| 场景 | 用法 | 存量连接 | TIME_WAIT 侧 |
|---|---|---|---|
| 快关 | `-s stop`（TERM） | 立刻断开 | 客户端侧产生 |
| 优雅关 | `-s quit`（QUIT） | 送完最后一个才退 | 服务端侧产生 |
| 热升级 | USR2 + WINCH + TERM | 全程不断 | 无 |

## reload 时序（第 7 章六步的速查版）

```text
1. master 收 HUP
2. 重读 nginx.conf —— 解析失败则原样放弃，线上无感
3. 用新配置 fork 新 worker
4. 向旧 worker 发 QUIT
5. 旧 worker 不再接新客，存量连接服务到底
6. 旧 worker 逐一送客退出；期间两代 worker 并存是正常账单
```

## 查看与定位

- `ps -ef | grep nginx`：找 master/worker（master 的父进程是 1 号或启动者；root 那个是 master）。
- `nginx -t`：只验配置不生效——reload 前先跑它，就是六步时序里第 2 步的保命符。
- `cat /var/run/nginx.pid`：master 的 PID，热升级三连发都对着它。
