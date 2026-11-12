import { useState } from "react";
import { readFolder, publish, type Preview, type Publication } from "./api";

export default function App() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Publication | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [uncertain, setUncertain] = useState(false);

  async function load() {
    setBusy(true);
    setMessage("");
    setPreview(null);
    setResult(null);
    setReviewed(false);
    try {
      setPreview(await readFolder());
    } catch {
      setMessage(
        "No se pudo leer la carpeta. Revisa la conexión y la configuración de Drive en el servidor.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!preview || busy || !reviewed || uncertain) return;
    if (preview.expires <= Date.now()) {
      setMessage("La vista previa venció. Vuelve a leer la carpeta.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      setResult(await publish(preview.previewId));
    } catch {
      setUncertain(true);
      setMessage(
        "No se confirmó el resultado. Revisa Instagram y el registro del servidor antes de volver a publicar.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main aria-busy={busy}>
      <h1>Centrificador</h1>
      <p>Lee el contenido de Drive, revisa el post y publícalo en Instagram.</p>
      <button type="button" onClick={load} disabled={busy || uncertain}>
        {busy ? "Procesando…" : "Leer carpeta de Drive"}
      </button>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {preview && (
        <section aria-labelledby="preview-title">
          <h2 id="preview-title">Vista previa</h2>
          <p>Cuenta de destino: {preview.accountId}</p>
          <p>Texto: {preview.sources?.text?.name ?? "Documento de Drive"}</p>
          <p>Imagen: {preview.sources?.image?.name ?? "Imagen de Drive"}</p>
          <img
            className="max-w-full"
            src={preview.imagePath}
            alt="Imagen seleccionada en Drive para el post"
          />
          <p className="whitespace-pre-wrap">{preview.caption}</p>
          <p>Válida hasta: {new Date(preview.expires).toLocaleString("es")}</p>
          {!result && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy || uncertain}
                  onChange={(event) => setReviewed(event.target.checked)}
                />{" "}
                Revisé el contenido y la cuenta de destino
              </label>
              <p>
                <button
                  type="button"
                  onClick={send}
                  disabled={busy || !reviewed || uncertain}
                >
                  Publicar en Instagram
                </button>
              </p>
            </>
          )}
        </section>
      )}
      {result && (
        <p role="status">Publicación confirmada. ID: {result.mediaId}</p>
      )}
    </main>
  );
}
