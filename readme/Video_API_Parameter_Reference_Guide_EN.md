> **Core Logic**: Frontend uses standardized parameters (resolution, duration, mode, etc.) → `video_param_mapper.js` auto-converts → incompatible fields are stripped before API calls

---

## I. Veo Series (Google)

### 🟢 veo3.1 / veo3.1-4k (Standard / High Quality)

| Frontend Config (UI) | Actually Sent to API | Status | Explanation |
|---------------------|---------------------|--------|--------------|
| resolution | ❌ Removed | 🚫 Ineffective | Quality determined by model version; passing causes error |
| mode | `generation_mode` | ✅ Effective | quality→pro, fast→fast, standard→"null" |
| aspect_ratio | `aspect_ratio` | ✅ Effective | 16:9 / 9:16 passed as-is |
| duration | ❌ Removed | 🚫 Ineffective | Veo doesn't support custom duration; auto-blocked |
| enhance_prompt | `enhance_prompt: "true/false"` | ✅ Effective | Boolean converted to string |
| enable_upsample | `enable_upsample` | ✅ Effective | Hidden parameter, passed if supported |

### 🔵 veo3.1-lite (Lite Version)

| Frontend Config (UI) | Actually Sent to API | Status | Explanation |
|---------------------|---------------------|--------|--------------|
| resolution | `quality: "sd/4k"` | ✅ Effective | 4K→"4k", 720P/1080P→"sd" |
| mode | ❌ Removed | 🚫 Ineffective | Lite version doesn't support generation mode |
| aspect_ratio | `aspect_ratio` | ✅ Effective | Passed as-is |
| duration | ❌ Removed | 🚫 Ineffective | Lite version doesn't support duration |
| enhance_prompt | `enhance_prompt` | ✅ Effective | Boolean converted to string |
| enable_upsample | ❌ Removed | 🚫 Ineffective | Lite version doesn't support this feature |

---

## II. Grok Series (xAI)

### 🟣 grok-video-3 (Standard Version)

| Frontend Config (UI) | Actually Sent to API | Status | Explanation |
|---------------------|---------------------|--------|--------------|
| resolution | `size: "720P"` | ✅ Effective | Grok calls resolution "size", only supports 720P |
| aspect_ratio | `aspect_ratio` | ✅ Effective | Supports 16:9 / 9:16 / 2:3 / 3:2 / 1:1 |
| duration | `duration` | ✅ Effective | Only 6s or 10s. Mapping rule: ≤6 → `"6"`, ≥7 → `"10"` |
| images | `images` | ✅ Effective | Optional first frame image, no image = text-to-video |
| mode | ❌ Removed | 🚫 Ineffective | Grok doesn't recognize generation mode, auto-stripped |
| sound | ❌ Removed | 🚫 Ineffective | grok-video-3 no longer supports sound parameters |

### 🆕 grok-imagine-video-1.5-preview (Imagine 1.5)

**Description**: xAI official Imagine 1.5 video model, focused on image-to-video, built-in audio, 1-15s flexible duration.

> ⚠️ Only supports image-to-video, **must** pass a first frame reference image

| Frontend Config (UI) | Actually Sent to API | Status | Explanation |
|---------------------|---------------------|--------|--------------|
| resolution | `resolution` | ✅ Effective | 720p or 480p |
| aspect_ratio | `aspect_ratio` | ✅ Effective | 16:9 / 9:16 / 1:1 / 3:2 / 2:3 |
| duration | `duration` | ✅ Effective | 1-15s, billed per second |
| images | `images` | ✅ Required | Must pass 1 image as first frame |
| mode | ❌ Removed | 🚫 Ineffective | Generation mode not supported |
| sound | ✅ Built-in | ✅ Included | Model automatically generates audio, no extra params needed |

### ⚪ grok-video-3-plus / grok-videos (Deprecated)

> ⚠️ The platform no longer provides `grok-video-3-plus` and `grok-videos` models, please migrate to `grok-video-3` or `grok-imagine-video-1.5-preview`.

---

## III. Parameter Flow Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Frontend Unified Input                          │
│   resolution  duration  mode  aspect_ratio  enhance_prompt  sound   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   video_param_mapper.js Mapping Script              │
│  ① Convert field names based on model version                     │
│  ② Auto-delete incompatible parameters                            │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
┌───────────────┐        ┌───────────────┐        ┌───────────────┐
│    Veo Series │        │ grok-video-3  │        │ Imagine 1.5   │
├───────────────┤        ├───────────────┤        ├───────────────┤
│ generation_  │        │ size          │        │ resolution    │
│ mode / quality│        │ duration      │        │ duration      │
│ aspect_ratio  │        │ aspect_ratio  │        │ aspect_ratio  │
└───────────────┘        └───────────────┘        └───────────────┘
```

---

## IV. Common Error Quick Reference

| Error Message | Possible Cause | Fixed Solution |
|--------------|---------------|---------------|
| Undefined field: generation_mode | Passed mode to Grok | ✅ Auto-stripped |
| Unknown parameter: quality | Passed resolution to Veo standard | ✅ Auto-stripped |
| Parameter validation failed: size | Passed size to Imagine 1.5 | ✅ Auto-converted/stripped |
| Unsupported parameter: generate_audio | Passed sound to grok-video-3 | ✅ Auto-stripped |

---

## V. Recommended Config Combinations

### 🎯 Veo Series Recommendations
| Scenario | Model | Recommended Params |
|----------|------|-------------------|
| High quality video | veo3.1-4k | mode=quality, aspect_ratio=16:9 |
| Fast output | veo3.1-lite | resolution=4K, aspect_ratio=16:9 |

### 🎯 Grok Series Recommendations
| Scenario | Model | Recommended Params |
|----------|------|-------------------|
| Standard video | grok-video-3 | resolution=720P, duration=10, aspect_ratio=16:9 |
| Img2Vid (with audio) | grok-imagine-video-1.5-preview | resolution=720P, duration=15, aspect_ratio=16:9, images required |

---

## VI. Guide for Adding New Models

```
┌─────────────────────────────────────────────────────────────┐
│                New Model Integration Process               │
├─────────────────────────────────────────────────────────────┤
│  1. Keep unified parameters on frontend                  │
│     (resolution/duration/mode...)                        │
│  2. Add new model mapping rules in video_param_mapper.js  │
│  3. Define unsupported fields → auto-delete & strip       │
│  4. Define model-specific fields → auto-convert names      │
└─────────────────────────────────────────────────────────────┘
```

> 💡 **Core Advantage**: No frontend changes needed, users unaware, new model integration just requires updating the mapping script!

---

## VII. Changelog

| Version | Changes | Status |
|---------|---------|--------|
| v1.0 | Veo series parameter mapping | ✅ Done |
| v1.1 | Grok series parameter mapping + legacy compatibility | ✅ Done |
| v1.2 | Auto-delete incompatible fields logic | ✅ Done |
| v1.3 | Audio parameter generate_audio mapping | ✅ Done |

---