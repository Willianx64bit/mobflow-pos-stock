const MAX_IMAGE_BYTES = 200 * 1024;

export async function compressImageTo200KB(file: File): Promise<File> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Formato permitido: PNG, JPG ou WEBP.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    let width = bitmap.width;
    let height = bitmap.height;
    const maxDimension = 1600;
    if (Math.max(width, height) > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    for (let resizeAttempt = 0; resizeAttempt < 8; resizeAttempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Não foi possível processar a imagem neste aparelho.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54, 0.46, 0.38]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
        if (blob && blob.size <= MAX_IMAGE_BYTES) {
          const base = file.name.replace(/\\.[^.]+$/, "") || "imagem";
          return new File([blob], base + ".webp", { type: "image/webp", lastModified: Date.now() });
        }
      }
      width = Math.round(width * 0.82);
      height = Math.round(height * 0.82);
    }
    throw new Error("Não foi possível reduzir esta imagem para até 200 KB. Escolha outra imagem.");
  } finally {
    bitmap.close();
  }
}
