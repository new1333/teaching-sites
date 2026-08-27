"""第 12 章测试：再拉近一点——微观放大层。

对应大纲 milestone 的断言：
1. Bitmap.crop / center_crop：挖子图与挖正中，越界、超尺寸即 ValueError；
2. is_action_question：动作类问题（按下按钮）触发，非动作问题不触发；
3. motion_peak_window：运动最高帧时刻 ± half，下限收口到 0，平手取最早；
4. extract_micro：窗口 clamp 到片长；首帧全图锚点 cropped=False，其余
   中心裁切 cropped=True 且尺寸可证（28×8）；窗口内密度盖过宏观；
5. run_micro：锚点＋放大帧序列交给模型（effort=high），截断注记照旧。
全程零网络：剧本回放，动作问题是否触发由调用方闸门决定。
"""
import pytest

from vision_rag.bitmap import Bitmap
from vision_rag.client import Client
from vision_rag.fake import ScriptedTransport
from vision_rag.micro import (
    extract_micro,
    is_action_question,
    motion_peak_window,
    run_micro,
)
from vision_rag.video import extract_frames, make_clip
from vision_rag.video_index import FrameCard

EVENT = (31.0, 34.0)   # 合成素材里那次 3 秒快速动作的起止秒
CLIP_W, CLIP_H = 40, 12   # 帧画面尺寸（与 video.py 的合成编排一致）
CROP_W, CROP_H = 28, 8    # 微观放大帧的裁切尺寸：主角行走行与道具列都在框内


def _no_sleep_client(transport):
    """造一个不真睡的 Client：暂停函数收下秒数但不等待。"""
    return Client(transport, sleep=lambda _seconds: None)


def _macro_cards():
    """宏观 0.5fps 抽帧后手工登记的帧卡：事件窗内运动为高。"""
    cards = {}
    for f in extract_frames(make_clip(), 0.5):
        inside = EVENT[0] <= f.t < EVENT[1]
        cards[f.t] = FrameCard(
            t=f.t, scene=f.scene,
            summary="主角快速冲撞" if inside else "主角缓慢走动",
            keywords=["车间"] + (["冲撞"] if inside else []),
            ocr="", event="", motion=f.motion)
    return cards


def _cards(levels: dict[float, str]):
    """按 {时刻: 运动强度} 手搭最小帧卡组——只喂 motion_peak_window 关心的字段。"""
    return {t: FrameCard(t=t, scene="", summary="", keywords=[],
                         ocr="", event="", motion=m)
            for t, m in levels.items()}


def _label_image_pairs(request: dict) -> list[tuple[str, str]]:
    """把请求拆成 (标签, 解码画面) 对——核对送审画面与标签的对应关系。"""
    import base64
    pairs: list[tuple[str, str]] = []
    pending = None
    for block in request["messages"][-1]["content"]:
        if block["type"] == "text" and block["text"].startswith("["):
            pending = block["text"]
        elif block["type"] == "image_url" and pending is not None:
            b64 = block["image_url"]["url"].split(",", 1)[1]
            pairs.append((pending, base64.b64decode(b64).decode("utf-8")))
            pending = None
    return pairs


# ---- 里程碑 1：Bitmap 的两把铲子 ----

def test_center_crop_cuts_middle():
    bmp = Bitmap(["123456", "abcdef", "UVWXYZ"])
    mid = bmp.center_crop(4, 2)                 # 偏移 ((6-4)//2, (3-2)//2) = (1, 0)
    assert (mid.width, mid.height) == (4, 2)
    assert mid.render() == "2345\nbcde"


def test_center_crop_odd_margin_biases_left_top():
    bmp = Bitmap(["abcd", "efgh", "ijkl", "mnop"])
    mid = bmp.center_crop(3, 3)                 # 余量为奇：偏移取 (0, 0)，偏左上
    assert mid.render() == "abc\nefg\nijk"


def test_crop_and_center_crop_validate_bounds():
    bmp = Bitmap(["123456", "abcdef"])
    assert bmp.crop(1, 0, 4, 2).render() == "2345\nbcde"   # 挖子图本体
    with pytest.raises(ValueError):
        bmp.crop(0, 0, 7, 2)                    # 宽越界
    with pytest.raises(ValueError):
        bmp.crop(-1, 0, 2, 2)                   # 负起点
    with pytest.raises(ValueError):
        bmp.crop(0, 0, 0, 2)                    # 非正尺寸
    with pytest.raises(ValueError):
        bmp.center_crop(7, 1)                   # 中心裁切超过原图：放大不归 Bitmap 管


# ---- 里程碑 2：动作问题触发与峰值窗口 ----

def test_action_question_trigger_words():
    assert is_action_question("他第几秒按下了按钮")          # 痛点原句
    assert is_action_question("快速动作的轨迹与落点")
    assert not is_action_question("推搡发生在什么时候")       # 3 秒事件宏观可见，不归微观层
    assert not is_action_question("车间的整体布局是什么")
    assert not is_action_question("")


def test_motion_peak_window_covers_peak_frame():
    window = motion_peak_window(_macro_cards())
    peak = 32.0    # 宏观 0.5fps 下，事件窗 (31, 34) 里被抽到的唯一一帧
    assert window == (30.5, 33.5)
    assert window[0] <= peak <= window[1]        # 窗口盖住运动峰值帧


def test_motion_peak_window_rank_tie_and_floor():
    assert motion_peak_window(_cards({0.0: "低", 5.0: "中", 10.0: "高"})) == (8.5, 11.5)
    assert motion_peak_window(_cards({31.0: "高", 32.0: "高", 33.0: "高"})) == (
        29.5, 32.5)                              # 平手取最早：先到的峰值不被顶掉
    assert motion_peak_window(_cards({0.0: "高"})) == (0.0, 1.5)  # 下限收口到 0


def test_motion_peak_window_validates():
    with pytest.raises(ValueError):
        motion_peak_window({})
    with pytest.raises(ValueError):
        motion_peak_window(_cards({1.0: "高"}), half=-1)


# ---- 里程碑 3：高密度重抽与首帧锚点 ----

def test_extract_micro_anchor_then_zoomed():
    source = make_clip()
    frames = extract_micro(source, 32.0)         # 峰值帧 ±1.5 秒，12fps 重抽
    assert [f.t for f in frames] == [30.5, 31.0, 31.5, 32.0, 32.5, 33.0]
    assert frames[0].cropped is False            # 首帧全图锚点
    assert (frames[0].bitmap.width, frames[0].bitmap.height) == (CLIP_W, CLIP_H)
    for f in frames[1:]:
        assert f.cropped is True                 # 其余中心裁切，尺寸可证
        assert (f.bitmap.width, f.bitmap.height) == (CROP_W, CROP_H)
    by_t = {f.t: f for f in source.frames}
    assert frames[0].bitmap.render() == by_t[30.5].bitmap.render()
    assert frames[3].bitmap.render() == by_t[32.0].bitmap.crop(
        6, 2, CROP_W, CROP_H).render()           # 放大帧＝该帧正中 28×8 的逐字符切片


def test_extract_micro_clamps_and_validates():
    head = extract_micro(make_clip(), 0.5)       # 窗口左端收口到片头
    assert head[0].t == 0.0 and head[0].cropped is False
    tail = extract_micro(make_clip(), 60.0)      # 右端收口到片尾
    assert [f.t for f in tail] == [58.5, 59.0, 59.5, 60.0, 60.5]
    with pytest.raises(ValueError):
        extract_micro(make_clip(), 61.0)         # 中心落在片长之外
    with pytest.raises(ValueError):
        extract_micro(make_clip(), 32.0, fps=0)  # 密度非正


def test_extract_micro_outdensifies_macro():
    macro = [f for f in extract_frames(make_clip(), 0.5) if 30.5 <= f.t < 33.5]
    micro = extract_micro(make_clip(), 32.0)
    assert len(macro) == 1 and macro[0].t == 32.0   # 宏观：窗口里只有一帧
    assert len(micro) == 6                          # 微观：同一窗口六帧


# ---- 里程碑 4：run_micro 与触发闸门 ----

def test_non_action_question_skips_micro_call():
    transport = ScriptedTransport([])            # 空剧本：一旦有人调用立刻露馅
    question = "车间里有哪些设备"
    if is_action_question(question):             # 调用方闸门：动作问题才追加微观
        run_micro(_no_sleep_client(transport), make_clip(),
                  motion_peak_window(_macro_cards()), question)
    assert transport.calls == 0                  # 非动作问题：一次模型调用都没发生


def test_run_micro_request_shape_and_reply():
    reply = "要点：主角在 [00:32] 冲进画面中央逼近道具。"
    transport = ScriptedTransport([(reply, "stop")])
    text = run_micro(_no_sleep_client(transport), make_clip(), (30.5, 33.5),
                     "他第几秒按下了按钮")
    assert text == reply
    req = transport.requests[0]
    assert req["reasoning_effort"] == "high"     # 微观分析对齐深读档位
    pairs = _label_image_pairs(req)
    assert pairs[0][0] == "[t=30.5s 全图锚点]"
    assert [label for label, _ in pairs[1:]] == [
        f"[t={t:.1f}s 放大]" for t in (31.0, 31.5, 32.0, 32.5, 33.0)]
    anchor_lines = pairs[0][1].split("\n")      # 锚点解码回 40×12 全图
    assert len(anchor_lines) == CLIP_H and all(len(x) == CLIP_W for x in anchor_lines)
    zoom_lines = pairs[1][1].split("\n")         # 放大帧解码回 28×8 裁切
    assert len(zoom_lines) == CROP_H and all(len(x) == CROP_W for x in zoom_lines)
    tail = req["messages"][-1]["content"][-1]
    assert tail["text"].endswith("用户问题：他第几秒按下了按钮")


def test_run_micro_truncation_note_and_window_validation():
    cut = ScriptedTransport([("要点过长被截断", "length")])
    text = run_micro(_no_sleep_client(cut), make_clip(), (30.5, 33.5),
                     "按下按钮的瞬间")
    assert "截断" in text                        # 截断要说破，不能装完整
    with pytest.raises(ValueError):
        run_micro(_no_sleep_client(ScriptedTransport([])), make_clip(),
                  (33.5, 30.5), "x")             # 起点不早于终点：不是窗口
