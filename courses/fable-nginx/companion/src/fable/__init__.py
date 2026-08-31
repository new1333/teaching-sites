"""fable-nginx：本课程的演进式迷你 nginx。

从 v0 阻塞版到 v5 反向代理版，每一章长出一个模块：
blocking_server / threaded_server / bench / event_loop / event_server /
http_parser / buffers / worker_pool / proxy_server / upstream_demo …
每个服务器模块都带 __main__ 入口，可 python -m fable.xxx 亲手开机。
"""
