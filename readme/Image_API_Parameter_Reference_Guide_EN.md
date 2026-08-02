> **Core logic**: The image field uses one standardized UI for resolution, aspect ratio, reference images, generation count, prompt, and model → the request is then routed by `provider` → each protocol builds its own payload. Do not assume that two requests use the same parameter format just because both models are named Gemini.
>
> **Applies to**: Hong's AI Table Studio v2.4.8  
> **Code basis**: `Grid.tsx`, `media_job_runner.js`, `lingwu_image_model_profiles.js`, `oss_reference_profiles.js`
>
> **This revision adds back**: the original `Gemini Custom` / Nano Banana-compatible image-size logic and a clear separation between `Gemini Format`, `Gemini Custom`, and `Lingwu Format`.

---

# Image API Parameter Mapping Reference Guide

## 1. Separate the Model from the Protocol

The same Gemini model name can be called through different protocols.

In the current project, image generation is routed through the following providers:

| Provider | Where it runs | Image support | Main request behavior |
|---|---|---:|---|
| `gemini` | Renderer | 🚫 Not currently supported | Image branch throws an error; mainly used for text |
| `gemini-custom` | Renderer | ✅ Supported | Calls `:generateContent` or `:predict` directly; reference images use Base64 `inlineData` |
| `lingwu` | Electron main process | ✅ Supported | Calls `/v1/media/generate`, creates Jobs, stores `task_id`, polls, and downloads locally |
| `openai` | Renderer | ✅ Partially supported | Calls `/images/generations`; reference images depend on the non-standard `base64Array` parameter |

You must distinguish:

```text
Gemini Custom protocol
≠
Gemini models called through Lingwu Format
```

Both branches may use model names such as:

```text
gemini-3-pro-image-preview
gemini-3.1-flash-image-preview
```

but their endpoints, reference-image transport, size defaults, response parsing, and task mechanisms are different.

---

## 2. Standardized Front-End Configuration

The Smart Image field exposes these common UI settings:

| UI setting | Variable in `Grid.tsx` | Purpose |
|---|---|---|
| Resolution | `resolution` | Usually 1K / 2K / 4K |
| Aspect ratio | `ratio` | 1:1 / 3:4 / 16:9, etc. |
| Reference images | `imageParts` / `finalOriginalUrls` | Converted to Base64 or uploaded to OSS depending on protocol |
| Generation count | `count` | Executed differently by each protocol |
| Prompt | `finalPrompt` | Sent to the model |
| Model | `resolvedModel` | Used to select provider and model mapping |

“Standardized” only means the UI is consistent.

After entering the generation branch:

```text
Gemini Custom
→ Builds Gemini JSON directly

Lingwu Format
→ Builds imageSize / aspectRatio / images
→ Then passes them through the model profile mapper

OpenAI Format
→ Converts them to size / n / response_format
```

---

# Part I: Gemini Native and Compatible Protocols

## 3. Gemini Format

### `provider === "gemini"`

The current image branch does not send a request. It throws an error similar to:

```text
Local Gemini Image generation not natively supported...
Please use OpenAI-compatible proxy for images.
```

Therefore, in the current project:

| Capability | Status |
|---|---:|
| Gemini text | ✅ Supported |
| Gemini Format image generation | 🚫 Not supported |
| Local reference images | 🚫 Not supported |
| 1K / 2K / 4K image size | 🚫 Not sent |
| Aspect ratio | 🚫 Not sent |

To generate Gemini images, use either:

```text
Gemini Custom
```

or:

```text
LingwuAI Format + a Gemini image model
```

---

## 4. Gemini Custom Protocol

### `provider === "gemini-custom"`

This is the original branch used for Nano Banana and Gemini-compatible image APIs.

It runs in the Renderer and does not use:

```text
MediaJobRunner
LingwuClient
OSS Uploader
Network Job Store
task_id polling
resumable downloading
```

### 4.1 Endpoint Composition

If the configured endpoint is a base URL, for example:

```text
https://generativelanguage.googleapis.com/v1beta
```

the code automatically builds:

```text
https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

If the endpoint already includes one of the following actions, the code does not append another action:

```text
:predict
:generateContent
:generateImages
```

The API key is appended as:

```text
?key={API_KEY}
```

---

## 5. Gemini Custom: `:generateContent` Size Logic

This is the main image request mode used by Gemini Custom.

### 5.1 Request Structure

```json
{
  "contents": [
    {
      "parts": [
        {
          "inlineData": {
            "mimeType": "image/jpeg",
            "data": "..."
          }
        },
        {
          "text": "Image generation prompt"
        }
      ],
      "role": "user"
    }
  ],
  "generationConfig": {
    "responseModalities": ["IMAGE"],
    "imageConfig": {
      "aspectRatio": "3:4",
      "numberOfImages": 1,
      "imageSize": "2K"
    }
  }
}
```

### 5.2 Actual Resolution Rules

The code behaves like this:

```ts
const geminiImageSize =
  resolution
    ? resolution.toUpperCase()
    : undefined;

const imageConfig = {
  aspectRatio: ratio,
  numberOfImages: 1
};

if (
  geminiImageSize &&
  geminiImageSize !== '1K'
) {
  imageConfig.imageSize =
    geminiImageSize;
}
```

Actual behavior:

| Front-end resolution | Actual request | Meaning |
|---|---|---|
| 1K / 1k | **Does not send `imageSize`** | Uses the Gemini endpoint's default image size |
| 2K / 2k | `imageSize: "2K"` | Explicitly requests 2K |
| 4K / 4k | `imageSize: "4K"` | Explicitly requests 4K |
| Empty | **Does not send `imageSize`** | Uses the endpoint default |
| Other values, such as 3K | `imageSize: "3K"` | Not validated by current code; the server may reject it |

> **Important**: In Gemini Custom, selecting 1K does not send `"1K"`. The `imageSize` field is omitted.

### 5.3 Aspect-Ratio Logic

The ratio is written directly to:

```json
{
  "imageConfig": {
    "aspectRatio": "3:4"
  }
}
```

The current code does not maintain a model-specific aspect-ratio whitelist for Gemini Custom and does not automatically correct invalid ratios.

Therefore:

```text
The front end sends the value as entered
→ The target endpoint decides whether to accept it
```

### 5.4 Generation Count

The UI `count` value is not sent as:

```json
{
  "numberOfImages": 4
}
```

Each request always contains:

```json
{
  "numberOfImages": 1
}
```

The application then sends multiple requests in parallel:

```text
count = 1
→ 1 request

count = 4
→ 4 parallel requests
→ 1 image per request
```

This is similar to Lingwu creating multiple independent Jobs, but Gemini Custom does not create local Job records.

---

## 6. Gemini Custom: Reference-Image Logic

### 6.1 How Reference Images Are Sent

Gemini Custom does not use OSS URLs.

Local images are converted in the Renderer to:

```json
{
  "inlineData": {
    "mimeType": "image/jpeg",
    "data": "Base64 data"
  }
}
```

They are then inserted together with the prompt into:

```text
contents[0].parts
```

Example:

```json
{
  "contents": [
    {
      "parts": [
        { "inlineData": { "mimeType": "...", "data": "..." } },
        { "inlineData": { "mimeType": "...", "data": "..." } },
        { "text": "Prompt" }
      ],
      "role": "user"
    }
  ]
}
```

### 6.2 Multiple Reference Images

Every image in `imageParts` is added as an `inlineData` part.

The Gemini Custom branch does not enforce:

```text
maxReferenceImages: 14
```

That 14-image setting belongs to the Lingwu image profile and does not automatically restrict Gemini Custom.

The actual number of images supported by Gemini Custom depends on the connected Gemini-compatible service.

### 6.3 Weak-Network Behavior

All reference images are converted to Base64 and included in one large JSON request.

Therefore:

```text
More reference images
→ Larger request body
→ Longer upload time
→ Higher timeout risk on weak corporate networks
```

Gemini Custom currently does not provide:

- OSS upload caching;
- `task_id`;
- background polling;
- `.part` downloads;
- restart recovery;
- `submission_unknown` Job records.

If a request fails, whether it may already have incurred a charge depends on the connected provider.

---

## 7. Gemini Custom: `:predict` Size Logic

If the endpoint contains:

```text
:predict
```

the application uses another request format:

```json
{
  "instances": [
    {
      "prompt": "Image generation prompt"
    }
  ],
  "parameters": {
    "sampleCount": 1,
    "aspectRatio": "3:4"
  }
}
```

### 7.1 Parameter Status

| Front-end setting | Sent to `:predict` | Status |
|---|---|---:|
| Prompt | `instances[0].prompt` | ✅ |
| Aspect ratio | `parameters.aspectRatio` | ✅ |
| Generation count | `sampleCount: 1`, with multiple outer requests | ✅ |
| 1K / 2K / 4K | **Not sent** | 🚫 |
| `imageSize` | **Not sent** | 🚫 |
| Reference images in `imageParts` | **Not sent** | 🚫 |

> The current `:predict` branch only sends the prompt and aspect ratio. Even when reference images have already been collected by the front end, they are not inserted into this payload.

As a result, the current `:predict` branch is closer to:

```text
Text-to-image
```

and is not suitable for workflows that depend on multiple local product references.

### 7.2 `:generateImages` Note

Endpoint detection treats:

```text
:generateImages
```

as a complete endpoint and does not append `:generateContent`.

However, payload construction currently only distinguishes:

```text
Contains :predict
→ Predict payload

Everything else
→ GenerateContent payload
```

Therefore, a `:generateImages` endpoint currently receives a `generateContent`-style payload.

If the target service expects a different schema for `:generateImages`, it may return a parameter error.

---

## 8. Gemini Custom Response Parsing

### `:predict`-Style Response

If the response contains:

```text
predictions[]
```

the program reads:

```text
bytesBase64Encoded
```

and converts it to:

```text
data:image/png;base64,...
```

### `:generateContent`-Style Response

If the response contains:

```text
candidates[0].content.parts
```

the program processes each part in order:

1. `part.inlineData`
   - converted into a Data URL;
2. `part.text`
   - checked for a Markdown image URL;
   - otherwise used directly as the returned text value.

If neither response structure exists, the program throws:

```text
Invalid response from Gemini Custom Image Endpoint
```

---

## 9. Gemini Custom Quick Parameter Table

### `:generateContent`

| UI setting | Actual field | Status | Notes |
|---|---|---:|---|
| 1K | `imageSize` omitted | ✅ | Uses the server default |
| 2K | `imageSize: "2K"` | ✅ | Explicitly requests 2K |
| 4K | `imageSize: "4K"` | ✅ | Explicitly requests 4K |
| Aspect ratio | `aspectRatio` | ✅ | Sent as entered |
| Reference images | `contents.parts[].inlineData` | ✅ | Supports multiple images |
| Count | Multiple parallel requests | ✅ | Each request uses `numberOfImages: 1` |
| OSS | Not used | — | Images are sent directly as Base64 |
| Job Center | Not used | — | No background Job is created |

### `:predict`

| UI setting | Actual field | Status | Notes |
|---|---|---:|---|
| 1K / 2K / 4K | Not sent | 🚫 | No current resolution field |
| Aspect ratio | `parameters.aspectRatio` | ✅ | Sent as entered |
| Reference images | Not sent | 🚫 | Current payload contains only the prompt |
| Count | Multiple parallel requests | ✅ | Each request uses `sampleCount: 1` |

---

# Part II: Lingwu Format Image Protocol

## 10. Lingwu Format Overview

### `provider === "lingwu"`

The Renderer first builds:

```js
{
  imageSize: "2K",
  aspectRatio: "3:4",
  images: [
    "file:///D:/product/front.jpg",
    "file:///D:/product/detail.jpg"
  ]
}
```

Then the request enters the Electron main process:

```text
Select the model profile
→ Upload local reference images to OSS
→ Map image parameters
→ POST /v1/media/generate
→ Store task_id
→ Poll in the background
→ Download the result
→ Write back to the original cell
```

Lingwu Format Gemini models and Gemini Custom do not share the same request builder.

---

## 11. Lingwu + Gemini Image Models

Applicable models:

```text
gemini-3-pro-image-preview
gemini-3.1-flash-image-preview
```

### 11.1 Parameter Mapping

| UI setting | Lingwu API parameter | Status |
|---|---|---:|
| Resolution | `imageSize` | ✅ |
| Aspect ratio | `aspectRatio` | ✅ |
| Reference images | `images`, containing OSS URLs | ✅ |
| Quality parameter | `quality` removed | 🚫 |
| Traditional pixel size | `size` not generated | 🚫 |

### 11.2 Resolution Rules

| Front-end value | Actual `imageSize` |
|---|---|
| 1K / 1k | `"1K"` |
| 2K / 2k | `"2K"` |
| 4K / 4k | `"4K"` |
| Empty | `"1K"` |
| Unrecognized | `"1K"` |

This differs from Gemini Custom:

```text
Gemini Custom 1K
→ Omits imageSize

Lingwu Gemini 1K
→ Explicitly sends imageSize: "1K"
```

### 11.3 Aspect-Ratio Profile

The profile lists:

```text
1:1
2:3
3:2
3:4
4:3
4:5
5:4
9:16
16:9
21:9
```

The profile records valid ratios, but the mapper does not yet actively block invalid ratios.

### 11.4 Reference-Image Limit

The profile records:

```text
maxReferenceImages: 14
```

The current code does not yet truncate or block submissions above this limit, so users should manually keep the count at 14 or below.

---

## 12. Lingwu + Seedream 5

Model:

```text
doubao-seedream-5-0-260128
```

Seedream uses:

```text
size
aspect_ratio
```

### 12.1 Parameter Mapping

| UI setting | Actual field |
|---|---|
| `imageSize` | Converted to `size` |
| `aspectRatio` | Converted to `aspect_ratio` |
| `quality` | Removed |
| `images` | OSS URLs are preserved |

### 12.2 Resolution Mapping

| Front-end value | Actual `size` |
|---|---|
| 0.5K | `"2K"` |
| 1K | `"2K"` |
| 2K | `"2K"` |
| 3K | `"3K"` |
| 4K | `"3K"` |
| Empty or other values | `"2K"` |

Therefore:

```text
Select 1K
→ Seedream actually receives 2K

Select 4K
→ Seedream actually receives 3K
```

The aspect ratio is renamed and then sent unchanged.

---

## 13. Other Lingwu Legacy Image Models

Any model without a dedicated profile falls back to:

```text
legacy-lingwu-image-v1
```

Logic:

```text
imageSize + aspectRatio
→ size: "widthxheight"

Delete imageSize
Delete aspectRatio
Delete quality
```

### 13.1 1K Mapping

| Ratio | `size` |
|---|---|
| 1:1 | `1024x1024` |
| 2:3 | `1024x1536` |
| 3:2 | `1536x1024` |
| 3:4 | `960x1280` |
| 4:3 | `1280x960` |
| 9:16 | `1088x1920` |
| 16:9 | `1920x1088` |

### 13.2 2K Mapping

| Ratio | `size` |
|---|---|
| 1:1 | `2048x2048` |
| 2:3 | `2048x3072` |
| 3:2 | `3072x2048` |
| 3:4 | `1920x2560` |
| 4:3 | `2560x1920` |
| 9:16 | `1440x2560` |
| 16:9 | `2560x1440` |

### 13.3 4K Mapping

| Ratio | `size` |
|---|---|
| 1:1 | `2880x2880` |
| 2:3 | `2304x3456` |
| 3:2 | `3456x2304` |
| 3:4 | `2400x3200` |
| 4:3 | `3200x2400` |
| 9:16 | `2160x3840` |
| 16:9 | `3840x2160` |

### 13.4 Approximate Mapping

| Configuration | Actual `size` |
|---|---|
| 1K + 21:9 | `1920x1088` |
| 1K + 4:5 | `960x1280` |
| 1K + 5:4 | `1280x960` |
| 1K + 1:2 | `1024x1536` |
| 1K + 2:1 | `1536x1024` |
| 2K + 21:9 | `2560x1440` |
| 2K + 4:5 | `1920x2560` |
| 2K + 5:4 | `2560x1920` |
| 4K + 21:9 | `3840x2160` |
| 4K + 4:5 | `2400x3200` |
| 4K + 5:4 | `3200x2400` |

If no mapping is found:

- If the input is already a pixel format such as `1024x1024`, it is sent unchanged;
- Otherwise, the mapper sends `size: "auto"`.

---

## 14. Lingwu Reference-Image OSS Profiles

### Gemini JPEG Profile

Used by the two Gemini models under Lingwu:

| Item | Rule |
|---|---|
| Profile ID | `gemini-jpeg-q95-v1` |
| Format | JPEG |
| Quality | 95 |
| Chroma subsampling | 4:4:4 |
| Dimensions | Original dimensions preserved |
| Prefix | `references-node-gemini-jpeg-v1/` |
| CSV | `oss_references_gemini_jpeg_node.csv` |
| dHash | Disabled |

### Standard WebP Profile

Used by Seedream and other Legacy image models:

| Item | Rule |
|---|---|
| Profile ID | `legacy-webp-q90-v1` |
| Format | WebP |
| Quality | 90 |
| Dimensions | Original dimensions preserved |
| Prefix | `references-node/` |
| CSV | `oss_references_node.csv` |
| dHash | Enabled |

Q95 and Q90 here mean:

```text
Compression quality used when uploading reference images to OSS
```

They do not mean:

```text
The generated-image API quality parameter
```

---

## 15. Comparison of the Two Gemini Image Protocols

| Item | Gemini Custom | Lingwu + Gemini |
|---|---|---|
| Provider | `gemini-custom` | `lingwu` |
| Execution location | Renderer | Electron main process |
| Endpoint | `:generateContent` / `:predict` | `/v1/media/generate` |
| 1K | Omits `imageSize` | Sends `"1K"` |
| 2K | Sends `"2K"` | Sends `"2K"` |
| 4K | Sends `"4K"` | Sends `"4K"` |
| Aspect ratio | `imageConfig.aspectRatio` | `params.aspectRatio` |
| Reference images | Base64 `inlineData` | OSS URLs |
| Reference-image limit | Not enforced in current code | Profile says 14, but not enforced |
| Count | Multiple parallel HTTP requests | Multiple independent Jobs |
| `task_id` | No | Yes |
| Job Center | No | Yes |
| Restart recovery | No | Yes |
| Resumable download | No | Yes |
| Weak-network upload | One large JSON request | Uploaded and cached in OSS first |
| Result | Data URL / text URL | Remote URL, then local download |

---

## 16. Image Protocol Flow Diagram

```text
┌────────────────────────────────────────────────────────────────────┐
│                         Image Field UI                             │
│ resolution  ratio  source images  count  prompt  model            │
└───────────────────────────────┬────────────────────────────────────┘
                                │
                       Route by provider
                                │
          ┌─────────────────────┼────────────────────────┐
          ▼                     ▼                        ▼
┌──────────────────┐  ┌────────────────────┐  ┌────────────────────┐
│ Gemini Format    │  │ Gemini Custom      │  │ Lingwu Format      │
├──────────────────┤  ├────────────────────┤  ├────────────────────┤
│ Image unsupported│  │ Renderer fetch     │  │ Electron main       │
│ Shows an error   │  │ Base64 inlineData  │  │ OSS + Job + polling │
└──────────────────┘  └─────────┬──────────┘  └──────────┬─────────┘
                                │                        │
                  ┌─────────────┴──────────┐   ┌─────────┼───────────┐
                  ▼                        ▼   ▼         ▼           ▼
          ┌────────────────┐       ┌──────────┐ ┌──────────┐ ┌────────────┐
          │ generateContent│       │ predict  │ │ Gemini   │ │ Seedream / │
          ├────────────────┤       ├──────────┤ ├──────────┤ │ Legacy     │
          │ 1K omits size  │       │ No size  │ │imageSize │ │ size       │
          │ 2K/4K explicit │       │ Ratio only│ │ ratio   │ │ widthxheight│
          │ inlineData     │       │ No refs   │ │OSS JPEG │ │ OSS WebP   │
          └────────────────┘       └──────────┘ └──────────┘ └────────────┘
```

---

## 17. Error Quick Reference

| Error or symptom | Possible cause | Recommended action |
|---|---|---|
| Gemini image generation says unsupported | Provider is ordinary `gemini` | Switch to `gemini-custom` or `lingwu` |
| No `imageSize` is visible in a 1K request | Gemini Custom is being used | Normal behavior; 1K omits the field |
| 2K / 4K does not take effect | Endpoint is `:predict` | Current `:predict` payload does not send resolution |
| Reference images are missing | Endpoint is `:predict` | Use `:generateContent` |
| `:generateImages` returns parameter errors | Current code sends a `generateContent`-style payload | Use a compatible `:generateContent` endpoint or add a dedicated adapter |
| Request body is too large or times out | Gemini Custom converts all references to Base64 | Reduce or compress images, or switch to the Lingwu OSS flow |
| Gemini rejects `imageSize` | UI contains an unvalidated value such as 3K | Use 1K / 2K / 4K |
| Lingwu Gemini reports unknown field `size` | Model name did not match the Gemini profile | Check the model name exactly |
| Lingwu reference details look degraded | Standard WebP profile was used by mistake | Check the model profile and `referenceProfileId` |
| Seedream receives 3K after selecting 4K | This is the current Seedream mapping | Expected behavior |
| Legacy API rejects `size: auto` | Resolution or ratio did not match a mapping | Use a standard combination from the mapping tables |
| Duplicate paid tasks appear | User resubmitted immediately after a creation timeout | Check for a `submission_unknown` Job first |

---

## 18. Recommended Configurations

### Gemini Custom: Nano Banana Pro

| Item | Recommended value |
|---|---|
| Provider | `Gemini Custom` |
| Endpoint | Gemini-compatible `/v1beta` base URL or full `:generateContent` endpoint |
| Model | `gemini-3-pro-image-preview` |
| Resolution | 2K or 4K |
| Aspect ratio | 3:4 / 1:1 / 16:9 |
| Reference images | Keep count and file size appropriate for network quality |
| Best for | Direct image generation without OSS |

### Lingwu + Gemini Pro

| Item | Recommended value |
|---|---|
| Provider | `LingwuAI Format` |
| Model | `gemini-3-pro-image-preview` |
| Resolution | 4K |
| Aspect ratio | 3:4 / 1:1 / 16:9 |
| Reference images | 3–10 recommended; manually keep at or below 14 |
| Best for | Job recovery, OSS caching, and automatic local saving |

### Choosing Between Gemini Custom and Lingwu

```text
Few reference images, stable network, direct Data URL result preferred
→ Gemini Custom

Many reference images, weak corporate network, restart recovery and auto-save needed
→ Lingwu Format
```

---

## 19. Rules for Adding New Models

### New Gemini Custom Endpoint

First identify whether the endpoint uses:

```text
:generateContent
:predict
:generateImages
another custom action
```

Do not assume the payload is the same merely because the model is Gemini.

### New Lingwu Image Model

Register the model in:

```text
LINGWU_IMAGE_MODEL_PROFILES
```

Define:

- exact model name;
- `requestMode`;
- `referenceProfileId`;
- resolution options;
- aspect-ratio options;
- maximum reference-image count.

Then add field mapping and field deletion rules to:

```text
buildLingwuImageParams()
```

---

## 20. Document Changelog

| Document version | Update | Status |
|---|---|---|
| v1.0 | Lingwu Gemini / Seedream / Legacy parameter mapping | ✅ |
| v1.1 | Dual OSS reference-image profiles | ✅ |
| v1.2 | Legacy pixel-size tables and error reference | ✅ |
| v1.3 | New-model integration workflow | ✅ |
| **v1.4** | **Restored Gemini Custom 1K / 2K / 4K, `:predict`, and Base64 reference-image logic** | ✅ |

---

## 21. Quick Summary

```text
Standard Gemini Format
→ Currently not supported for image generation

Gemini Custom + generateContent
→ 1K: omit imageSize
→ 2K: imageSize = "2K"
→ 4K: imageSize = "4K"
→ Ratio goes to imageConfig.aspectRatio
→ References go to contents.parts[].inlineData
→ count parallel requests, one image per request

Gemini Custom + predict
→ Sends prompt, aspectRatio, and sampleCount only
→ Does not send 1K / 2K / 4K
→ Does not currently send reference images

Lingwu + Gemini
→ Explicitly sends imageSize = 1K / 2K / 4K
→ Explicitly sends aspectRatio
→ Converts references to JPEG Q95 and uploads them to OSS
→ Creates Jobs, stores task_id, polls, and downloads locally
```

The four most important points:

1. **Gemini Custom and Lingwu Gemini are two different protocols.**
2. **Gemini Custom omits `imageSize` for 1K, while Lingwu Gemini explicitly sends `"1K"`.**
3. **The current `:predict` branch has no resolution or reference-image logic.**
4. **Only the Lingwu branch provides Job Center support, weak-network recovery, OSS caching, and resumable downloading.**
