import sharp from "sharp";

export const SCREEN_IMAGE = Object.freeze({
  width: 2560,
  height: 1440,
  quality: 92,
});
export const imageMime = (name) =>
  /\.jpe?g$/i.test(name)
    ? "image/jpeg"
    : /\.webp$/i.test(name)
      ? "image/webp"
      : "image/png";

// Apply one consistent screen profile. Existing suitable JPEGs pass through so
// repeated exports/imports do not compound lossy compression. Alpha-bearing
// graphics retain PNG; flattening these would break masks and motion cutouts.
export async function screenImage(
  bytes,
  {
    width = SCREEN_IMAGE.width,
    height = SCREEN_IMAGE.height,
    resize = true,
    force = false,
  } = {},
) {
  const image = sharp(bytes, { limitInputPixels: 40000000 });
  const meta = await image.metadata();
  const rotated = !!meta.orientation && meta.orientation !== 1;
  const alpha = meta.hasAlpha && !(await image.stats()).isOpaque;
  const fits = !resize || (meta.width <= width && meta.height <= height);
  const format = alpha ? "png" : "jpeg";
  let data = bytes,
    info = meta;
  if (force || rotated || !fits || meta.format !== format) {
    let output = image.rotate().toColourspace("srgb");
    if (resize)
      output = output.resize({
        width,
        height,
        fit: "inside",
        withoutEnlargement: true,
      });
    output = alpha
      ? output.png()
      : output
          .removeAlpha()
          .jpeg({
            quality: SCREEN_IMAGE.quality,
            chromaSubsampling: "4:4:4",
            mozjpeg: true,
          });
    ({ data, info } = await output.toBuffer({ resolveWithObject: true }));
  }
  return {
    data,
    width: info.width,
    height: info.height,
    format,
    extension: alpha ? "png" : "jpg",
    mime: alpha ? "image/png" : "image/jpeg",
  };
}
