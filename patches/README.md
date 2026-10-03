# Tokenizer declaration repair

`@huggingface/tokenizers@0.2.0` publishes ESM declarations with extensionless relative imports. TypeScript's NodeNext resolution rejects those imports (TS2834). The patch adds the correct `.js` suffix to declaration imports and re-exports; TypeScript resolves them to the adjacent `.d.ts` files.

The patch was generated against the pristine published npm archive. It changes no JavaScript, tokenization behavior, exported type, or compiler setting. The API retains strict checking and checks dependency declarations. Remove this patch when a verified upstream release supplies NodeNext-compatible declarations.

Embedding inference uses the actual tokenizer and ONNX CPU runtime with a pinned MiniLM model revision, attention-mask mean pooling and L2 normalization. The model files are cached separately from the source repository.
