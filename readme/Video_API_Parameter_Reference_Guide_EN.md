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

### 🟣 grok-video-3 (New Version)

| Frontend Config (UI) | Actually Sent to API | Status | Explanation |
|---------------------|---------------------|--------|--------------|
| resolution | `size: "720P/1080P"` | ✅ Effective | Grok calls resolution "size" |
| aspect_ratio | `aspect_ratio` | ✅ Effective | Passed as-is |
| duration | `duration` | ✅ Effective | Field name matches, passed directly |
| mode | ❌ Removed | 🚫 Ineffective | Grok doesn't recognize generation mode, auto-stripped |
| sound | `generate_audio` | ✅ Effective | Auto-mapped when audio column enabled |

### 🟠 grok-video-3-plus (Enhanced Version)

| Frontend Config (UI) | Actually Sent to API | Status | Explanation |
|---------------------|---------------------|--------|--------------|
| resolution | ❌ Removed | 🚫 Ineffective | Plus version doesn't accept resolution, blocked |
| aspect_ratio | `aspect_ratio` | ✅ Effective | Passed as-is |
| duration | `duration` | ✅ Effective | Passed directly |
| mode | ❌ Removed | 🚫 Ineffective | Auto-stripped |
| sound | `generate_audio` | ✅ Effective | Auto-mapped |

### ⚪ grok-videos (Legacy Version)

| Frontend Config (UI) | Actually Sent to API | Status | Explanation |
|---------------------|---------------------|--------|--------------|
| resolution | ❌ Removed | 🚫 Ineffective | Legacy uses aspect ratio for quality, stripped |
| aspect_ratio | `size: "16:9"` | ✅ Effective | Legacy quirk: aspect ratio field is "size" |
| duration | `seconds` | ✅ Effective | Legacy calls it "seconds", auto-converted |
| mode | ❌ Removed | 🚫 Ineffective | Auto-stripped |
| sound | `generate_audio` | ✅ Effective | Auto-mapped |

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
│    Veo Series │        │  Grok New     │        │ Grok Legacy   │
├───────────────┤        ├───────────────┤        ├───────────────┤
│ generation_  │        │ size          │        │ size(aspect)  │
│ mode / quality│        │ duration      │        │ seconds       │
│ aspect_ratio  │        │ aspect_ratio  │        │generate_audio│
└───────────────┘        └───────────────┘        └───────────────┘
```

---

## IV. Common Error Quick Reference

| Error Message | Possible Cause | Fixed Solution |
|--------------|---------------|---------------|
| Undefined field: generation_mode | Passed mode to Grok | ✅ Auto-stripped |
| Unknown parameter: quality | Passed resolution to Veo standard | ✅ Auto-stripped |
| Parameter validation failed: seconds | Passed duration to new Grok | ✅ Auto-converted |
| size field conflict | Legacy Grok aspect/resolution conflict | ✅ Auto-differentiated |

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
| Standard video | grok-video-3 | resolution=1080P, duration=5 |
| Enhanced version | grok-video-3-plus | duration=5, aspect_ratio=16:9 |
| Legacy project compatibility | grok-videos | duration=5, aspect_ratio=16:9 |

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