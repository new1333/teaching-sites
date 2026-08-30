"""事件循环：对 selectors 的小封装，把「等」集中到一条线程身上。

fable.event_loop — 三个动词就是全部骨架：登记（register——谁的事归谁管，
就绪了喊哪个回调）、等就绪（step——问内核哪路 IO 到货了）、分发（就绪名单
逐个喊回调）。run 只是让这三件事一圈一圈转。
"""
import selectors
import threading
import time
from typing import Callable


class EventLoop:
    """Reactor 模式的最小骨架：注册/注销、run 循环、回调分发。"""

    def __init__(self) -> None:
        # DefaultSelector 挑当前平台最合适的实现：Windows 落到 select，
        # Linux 是 epoll。同一份事件循环代码、两种内核机制，差异正文里量给你看。
        self._selector = selectors.DefaultSelector()
        self._stopping = False

    def register(
        self,
        fileobj: object,
        callback: Callable[[object, int], None],
        events: int = selectors.EVENT_READ,
    ) -> None:
        """登记：把 fileobj 交给内核盯，并留下「就绪后该喊谁」。"""
        self._selector.register(fileobj, events, data=callback)

    def unregister(self, fileobj: object) -> None:
        """注销：这路 IO 不用再盯了。没登记过的直接放过（幂等）。"""
        try:
            self._selector.unregister(fileobj)
        except KeyError:
            pass

    def step(self, timeout: float | None = 1.0) -> int:
        """跑一圈：问内核「谁就绪了」，逐个喊对应的回调；返回就绪了几路。"""
        if not self._selector.get_map():
            # Windows 的 select 见到空名单会报 WinError 10022（无效参数），
            # 没有要盯的就睡一拍再回——就绪名单自然是空。
            if timeout and timeout > 0:
                time.sleep(timeout)
            return 0
        ready = self._selector.select(timeout)
        for key, mask in ready:
            key.data(key.fileobj, mask)  # data 里存的就是登记时留下的回调
        return len(ready)

    def run(self, poll_interval: float = 1.0, stop_flag: threading.Event | None = None) -> None:
        """事件循环本体：一圈一圈跑 step，直到 stop() 或 stop_flag 喊停。"""
        self._stopping = False
        while not self._stopping:
            if stop_flag is not None and stop_flag.is_set():
                break
            self.step(timeout=poll_interval)

    def stop(self) -> None:
        """喊停：下一圈醒来就退场。"""
        self._stopping = True

    def idle(self) -> bool:
        """名单空了吗（一个被盯的 IO 都没有）——worker 优雅排干的退场判据。"""
        return not self._selector.get_map()

    def close(self, fileobj: object) -> None:
        """关一路 IO：先注销（不再被盯），再关闭。"""
        self.unregister(fileobj)
        try:
            fileobj.close()  # type: ignore[attr-defined]
        except OSError:
            pass

    def close_all(self) -> None:
        """收摊：盯着的每个 fileobj 注销并关掉，最后关掉 selector 本身。"""
        for key in list(self._selector.get_map().values()):
            self.close(key.fileobj)
        self._selector.close()
