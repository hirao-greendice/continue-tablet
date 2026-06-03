# Backup photos

Put offline fallback photos in this folder and list them in `backup-photos.json`.

Recommended image size: `960 x 1200px` (`4:5`).

Example:

```json
{
  "1": [
    { "label": "予備1", "src": "slot-1-1.jpg" },
    { "label": "予備2", "src": "slot-1-2.jpg" }
  ],
  "2": [
    { "label": "予備1", "src": "slot-2-1.jpg" }
  ],
  "3": [],
  "4": []
}
```

After changing backup images or this JSON, update `BACKUP_PHOTO_VERSION` in:

- `src/App.tsx`
- `public/sw.js`
