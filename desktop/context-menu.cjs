function imageContextMenu(web, params, ownsURL) {
  if (!ownsURL(params.frameURL || params.pageURL)) return [];
  const items = [];
  if (params.mediaType === "image" && params.hasImageContents) {
    items.push({
      label: "复制图片",
      click: () => {
        if (!web.isDestroyed()) web.copyImageAt(params.x, params.y);
      },
    });
  }
  if (params.isEditable)
    items.push(
      { role: "cut", label: "剪切", enabled: params.editFlags.canCut },
      { role: "copy", label: "复制", enabled: params.editFlags.canCopy },
      { role: "paste", label: "粘贴", enabled: params.editFlags.canPaste },
      { role: "selectAll", label: "全选" },
    );
  else if (params.selectionText) items.push({ role: "copy", label: "复制" });
  return items;
}
module.exports = { imageContextMenu };
