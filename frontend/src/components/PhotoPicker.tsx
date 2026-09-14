import { useRef } from "react";
import { Image as ImageIcon } from "lucide-react";

const MAX_PHOTO_BYTES = 700 * 1024;

/** Small square picture stored as a data URL (supplier logo, user avatar). */
export default function PhotoPicker({
  label,
  value,
  onChange,
  onError,
  rounded = "rounded-xl",
}: {
  label: string;
  value: string;
  onChange: (photo: string) => void;
  onError?: (message: string) => void;
  rounded?: string;
}) {
  const input = useRef<HTMLInputElement>(null);

  function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      onError?.("Photo trop lourde (700 Ko maximum)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-4">
        {value ? (
          <img
            src={value}
            alt=""
            className={`h-20 w-20 object-cover ${rounded}`}
          />
        ) : (
          <span
            className={`flex h-20 w-20 items-center justify-center bg-slate-100 text-slate-300 ${rounded}`}
          >
            <ImageIcon size={22} />
          </span>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => input.current?.click()}
          >
            Choisir une photo
          </button>
          {value && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => onChange("")}
            >
              Retirer
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
