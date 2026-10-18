# Editable translation prompts

The translation model is only one part of the reading experience. Literal word order, unresolved agency and unnecessarily formal diction can make otherwise accurate paragraphs difficult to read. Users need to control translation instructions independently of their provider and key.

## Reference

Immersive Translate separates translation instructions from source input, supports template variables and offers selectable “AI experts” made from prompt configurations. Its public documentation also describes context and terminology inputs:

- [Official prompt guide](https://immersivetranslate.com/zh-Hans/docs/prompts/)
- [Official AI expert repository](https://github.com/immersive-translate/prompts)

These references inform the interaction pattern. LeafRead's templates and implementation are original; no expert prompts or provider-specific formats were copied.

## LeafRead behavior

Both **Me → AI connection** and the reader's AI settings provide a translation prompt editor, three editable starting points (Natural, Academic, Close to source), a Custom state and reset to default. Users can write instructions, term choices and examples in any language. The default asks for clear contemporary prose, faithful reasoning and terminology, natural sentence structure and modern Chinese instead of archaic or mechanical phrasing.

`{{to}}` and `{{from}}` expand once to the target and source languages. The target paragraph, book title and adjacent passages remain separate reference data in the user payload. The output contract still requires only the translated target paragraph. Reading chat and retrieval prompts are unchanged. This first version does not implement per-book overrides, a multi-step translator, a terminology database or an expert marketplace.

`AIConnection.translationPrompt` stores the account's instructions in PostgreSQL. An empty value resolves to the default. Saving takes effect on subsequent requests without a deployment. Older clients that omit the field preserve the current value. Local mode without accounts keeps its prompt in browser preferences; API keys remain excluded from browser persistence. The account endpoint accepts at most 6000 prompt characters, within a bounded request body.

Translation cache keys include the effective prompt and normalized provider/model. Old translations and note anchors are retained, but a new prompt uses a separate cache identity. The automatic translation session cancels and restarts when prompt settings change. The demo's packaged translation is a fallback only when AI is not configured, so it does not hide a configured user's custom translation style.

If an account's configuration changes on another device, the server rejects a stale translation fingerprint before calling the paid provider and returns only public configuration metadata. The active reader applies the current settings and resumes with the corresponding cache key. Existing in-flight requests keep the settings they started with; prompt changes do not retroactively rewrite stored responses.

## Validation boundary

Use Prisma generation, TypeScript compilation, production build and deployment readiness checks. Per project instructions, no unit, integration or E2E tests and no paid model requests are run. Translation quality and the interactive settings flow remain for the user to verify.
