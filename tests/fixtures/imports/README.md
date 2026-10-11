# Import preservation fixtures

Synthetic two-process linked model, serialized by the actual PRISM interchange
exporters at engine main, then accepted by the live conversion endpoint on
2026-10-11. Formats yield six or seven normalized datasets; ZIP formats with contact support
include the synthetic owner referenced by the exported files. These are integration
examples, not proof that every vendor dialect or field maps correctly.

ZIPs deliberately contain unsupported JSON, a binary entry, and a French text
longer than one viewer section. Tests require retaining them independently of
conversion. `manifest.json` records exact upload sizes and SHA-256 hashes.

`tidas-missing-owner.zip` deliberately omits the owner. The engine marks this
conversion valid; the confirmation preflight must reject its unresolved references
before uploading or saving.

No customer or production data is included. Extend with independently supplied
vendor examples before claiming exhaustive format compatibility.
