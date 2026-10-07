// Speech is a derivative of the manuscript. Never write this back to slide.notes.
export const SPEECH_TEXT_VERSION = 3;
export function prepareSpeechText(input) {
  const removed = [];
  const omit = (text, reason) => {
    if (text.trim()) removed.push({ text: text.trim(), reason });
    return "";
  };
  let text = String(input || "").replace(/\r\n?|[\u2028\u2029]/g, "\n");
  text = text
    .replace(/<!--[^]*?-->/g, (s) => omit(s, "批注"))
    .replace(/【不口播】[^]*?【\/不口播】/g, (s) => omit(s, "明确标注不口播"))
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[^]*?^[ \t]*\1[^\n]*$/gm, (s) =>
      omit(s, "代码块"),
    )
    .replace(
      /!\[[^\]]*\]\((?:[^()\n]|\([^()\n]*\))*\)|!\[\[[^\]]*\]\]|!\[[^\]]*\]\[[^\]]*\]/g,
      (s) => omit(s, "图片附件"),
    )
    .replace(/\[([^\]]+)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, "$1")
    .replace(/\[\^[^\]]+\]/g, (s) => omit(s, "脚注编号"))
    .replace(/[\u200b\u2060\ufeff]/g, "");
  text = text.replace(
    /[【（\[(](?:轻笑|笑声|咳嗽|清嗓|叹气|换气)(?:[，,：:\s][^】）\])\n]*)?[】）\])]|^\s*(?:轻笑|笑声|咳嗽|清嗓|叹气|换气)[。.]?\s*$/gm,
    (s) => omit(s, "辅助表达提示"),
  );
  const stage =
    /^(?:(?:语气|语速|重读|舞台提示|动作)[：:]|(?:停顿(?:\s*[\d一二三四五六七八九十几]+\s*秒)?|暂停(?:\s*[\d一二三四五六七八九十几]+\s*秒)?|稍停|停一下|环顾(?:四周|全场|观众)?|环视(?:全场|观众)?|微笑|鞠躬|鼓掌|掌声|切换(?:到)?(?:下一页|PPT|画面)|翻页|播放(?:视频|音乐|音频)|点击(?:播放|下一页)|不口播)(?:[\s，,、。；;：:]|$))/i;
  text = text.replace(
    /【[^【】\n]{1,160}】|〔[^〔〕\n]{1,160}〕|\[[^\[\]\n]{1,160}\]|（[^（）\n]{1,160}）|\([^()\n]{1,160}\)/g,
    (s) => (stage.test(s.slice(1, -1).trim()) ? omit(s, "舞台或语气提示") : s),
  );
  let labelValue = false;
  text = text
    .split("\n")
    .map((line) => {
      const plain = line
        .replace(/\*\*|__/g, "")
        .replace(/^\s*[-+*>]\s+/, "")
        .trim();
      if (
        /^(?:(?:停顿|暂停|稍停|停一下)(?:\s*[\d一二三四五六七八九十几]+\s*秒)?|环顾(?:四周|全场|观众)?|环视(?:全场|观众)?|微笑|鞠躬|鼓掌|掌声|翻页)(?:\s*[，,、；;]\s*(?:停顿|暂停|微笑|环顾四周|环视全场))*[。.]?$/.test(
          plain,
        )
      )
        return omit(line, "舞台或语气提示");
      if (labelValue && plain) {
        labelValue = false;
        return omit(line, "标题或画面说明");
      }
      if (
        /^(?:主标题|副标题|一级菜单|二级菜单|一级标题|二级标题|章节标题|菜单|目录|标题页|页面标题|画面说明|配图说明)\s*[：:]?$/.test(
          plain,
        )
      ) {
        labelValue = true;
        return omit(line, "标题或画面标签");
      }
      if (
        /^\s{0,3}#{1,6}(?:\s|$)/.test(line) ||
        /^(?:开场|开场白|结束语|结尾|过渡页|目录页)$/.test(plain) ||
        (/^[一二三四五六七八九十]+[、．.]\s*\S/.test(plain) &&
          plain.length <= 80 &&
          !/[。！？!?；;]/.test(plain)) ||
        /^第[一二三四五六七八九十百\d]+(?:部分|章节|章|节)[：:、\s]/.test(plain)
      )
        return omit(line, "章节标题");
      if (
        /^(?:主标题|副标题|一级菜单|二级菜单|一级标题|二级标题|章节标题|菜单|目录|标题页|页面标题|画面(?:说明)?|配图(?:说明)?|舞台提示|动作提示|备注|不口播|预计用时|时长)\s*[：:]/.test(
          plain,
        )
      )
        return omit(line, "非口播说明");
      if (
        /^\s*(?:[-*_]\s*){3,}$/.test(line) ||
        /^\s*\[[^\]]+\]:\s*\S/.test(line)
      )
        return omit(line, "分隔线或链接定义");
      return line
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "")
        .replace(/(?:\*\*|__|~~|`)/g, "");
    })
    .join("\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, removed };
}
