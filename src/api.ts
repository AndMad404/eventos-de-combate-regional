export interface Preview {
  previewId: string;
  caption: string;
  accountId: string;
  imagePath: string;
  expires: number;
  sources: { text: { name?: string }; image: { name?: string } };
}
export interface Publication {
  status: "published";
  mediaId: string;
  permalink?: string;
}

async function post<T>(route: string): Promise<T> {
  const response = await fetch(`/api${route}`, {
    method: "POST",
    credentials: "same-origin",
    signal: AbortSignal.timeout(240000),
  });
  if (!response.ok) {
    if (response.status === 401)
      throw new Error("Falta configurar el acceso del servidor a la API.");
    if (response.status === 409)
      throw new Error(
        "La API detuvo la operación. Revisa la vigencia de la vista previa y el registro de publicaciones.",
      );
    throw new Error(`La API devolvió un error (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export async function readFolder(): Promise<Preview> {
  const result = await post<Preview>("/preview");
  if (
    !/^[a-f0-9]{48}$/.test(result.previewId) ||
    result.imagePath !== `/media/${result.previewId}.jpg` ||
    typeof result.caption !== "string" ||
    !Number.isFinite(result.expires)
  ) {
    throw new Error("La API devolvió una vista previa inválida.");
  }
  return result;
}

export async function publish(id: string): Promise<Publication> {
  if (!/^[a-f0-9]{48}$/.test(id)) throw new Error("Vista previa inválida.");
  const result = await post<Publication>(`/publish/${id}`);
  if (result.status !== "published" || !result.mediaId)
    throw new Error("No se pudo confirmar la publicación.");
  return result;
}
