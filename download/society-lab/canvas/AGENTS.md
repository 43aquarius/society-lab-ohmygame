# Canvas workspace

Canvas files are the source of truth in both Design and Asset Canvas. Use normal read, edit, and write tools to create and change boards, nodes, documents, and references.

- Read README.md and schemas/ before changing a contract. Run canvas_check after editing.
- index.json lists boards, documents, and the main document. Keep IDs stable; names and titles may change.
- boards/<id>.json contains nodes and their content. Every node may have a title and a description of its purpose. Document bodies live in documents/<id>.md, referenced by documentId.
- Give nodes meaningful titles. Descriptions explain their intended role; do not describe unseen image pixels as verified facts.
- editor/<board-id>.json stores positions and zoom. New nodes are placed automatically; layout edits are only needed when the user asks to arrange the canvas.
- assets.json maps asset IDs to names, workspace-relative paths, optional descriptions and generation prompts. Use the same ID for the same asset across boards. References with type "library" resolve through this manifest. libraryAssetId records provenance; local files remain usable without the Library.
- Read actual image files with read when judging their appearance. A name, description, or generation prompt is not proof of what the image shows.
- promptSource references a text or document node. images, references, and source declare media dependencies; their canvas lines are derived. Do not duplicate these relationships in edges.
- To add a local image, place it under assets/, add its path to assets.json, and reference its ID from an asset node or a generation node.
- Do not trigger generation merely by editing a prompt or adding a reference. When generation is requested, use generate_canvas_media with the saved boardId and nodeId; it uses the node settings and shared generation history.
- Packaging or compressing images must preserve all boards, nodes, generation settings and history, references, IDs, and editor coordinates/viewport. Keep referenced source sheets and local provenance; they are not caches.
- Removing a node or board keeps its documents and assets. Remove references to a deleted node from the same board.
- An editor-context block identifies the current board and selected nodes. Read the referenced files before editing, and preserve other user changes.
