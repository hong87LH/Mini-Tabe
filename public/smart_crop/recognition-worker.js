
let engine=null,modelInfo=null,mode='multi';
const visionWasmCdn='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const report=text=>postMessage({type:'status',text});
async function ready(preferred){if(engine)return;const {loadModel}=self.__ModelCache||await import(new URL('./model-cache.js',self.location.href).href);const asset=await loadModel(preferred,report);const {PoseLandmarker,FilesetResolver}=self.__Vision||await import(new URL('./vendor/vision_bundle.mjs',self.location.href).href);report('下载或读取缓存中的视觉运行时');const files=self.__MAKE_WASM_FILESET?await self.__MAKE_WASM_FILESET(FilesetResolver):await FilesetResolver.forVisionTasks(visionWasmCdn);report('初始化本地识别引擎');engine=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetBuffer:new Uint8Array(asset.bytes),delegate:'CPU'},runningMode:'IMAGE',numPoses:6,outputSegmentationMasks:false,minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45});modelInfo={...asset,bytes:undefined,model:'MediaPipe Pose Landmarker Full',sha256:'4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad',delegate:'WASM CPU',wasmSource:visionWasmCdn};postMessage({type:'ready',info:modelInfo});}
function score(p){return Math.min(p.visibility??1,p.presence??1);}
function pack(result,width,height,transform){
 report('正在整理识别结果');
 const tr=transform||{edge:1,contentWidth:1,contentHeight:1,offsetX:0,offsetY:0};
 const indexed=result.landmarks.map((pose,maskIndex)=>({maskIndex,points:pose.map(p=>({...p,x:(p.x*tr.edge-tr.offsetX)/tr.contentWidth,y:(p.y*tr.edge-tr.offsetY)/tr.contentHeight}))})).sort((a,b)=>(a.points[23].x+a.points[24].x)-(b.points[23].x+b.points[24].x));
 const landmarks=indexed.map(entry=>entry.points);
 const poses=[{canvas_width:width,canvas_height:height,people:landmarks.map((p,index)=>{const point=i=>[p[i].x*width,p[i].y*height,score(p[i])],neck=[(p[11].x+p[12].x)*width/2,(p[11].y+p[12].y)*height/2,Math.min(score(p[11]),score(p[12]))],order=[0,null,12,14,16,11,13,15,24,26,28,23,25,27,5,2,8,7];return {person_id:'P'+(index+1),pose_keypoints_2d:order.flatMap(i=>i===null?neck:point(i)),face_keypoints_2d:[0,1,2,3,4,5,6,7,8,9,10].flatMap(point),hand_left_keypoints_2d:[15,17,19,21].flatMap(point),hand_right_keypoints_2d:[16,18,20,22].flatMap(point),head_top_ratio:.25};})}];
 const row_spans=[],person_row_spans={};const masks=(result.segmentationMasks||[]).map(m=>({data:m.getAsFloat32Array(),width:m.width,height:m.height}));
 // Keep each mask paired with its original pose index before spatial sorting.
 // Head protection must not use another person's foreground or bridge their hair.
 for(const [index,entry]of indexed.entries()){
  const mask=masks[entry.maskIndex];if(!mask)continue;
  const rows=[],w=Math.min(192,mask.width),h=Math.min(256,mask.height);
  for(let y=0;y<h;y++){let start=-1;for(let x=0;x<=w;x++){
   const foreground=x<w&&mask.data[Math.min(mask.height-1,Math.floor((tr.offsetY+(y+.5)*tr.contentHeight/h)/tr.edge*mask.height))*mask.width+Math.min(mask.width-1,Math.floor((tr.offsetX+(x+.5)*tr.contentWidth/w)/tr.edge*mask.width))]>=.5;
   if(foreground&&start<0)start=x;else if(!foreground&&start>=0){rows.push([start/w*width,y/h*height,x/w*width,height/h]);start=-1;}
  }}person_row_spans['P'+(index+1)]=rows;
 }
 // Union multiple person masks without bridging gaps; bound sampling complexity.
 if(masks.length){const w=Math.min(192,masks[0].width),h=Math.min(256,masks[0].height);for(let y=0;y<h;y++){let start=-1;for(let x=0;x<=w;x++){const foreground=x<w&&masks.some(m=>m.data[Math.min(m.height-1,Math.floor((tr.offsetY+(y+.5)*tr.contentHeight/h)/tr.edge*m.height))*m.width+Math.min(m.width-1,Math.floor((tr.offsetX+(x+.5)*tr.contentWidth/w)/tr.edge*m.width))]>=.5);if(foreground&&start<0)start=x;else if(!foreground&&start>=0){row_spans.push([start/w*width,y/h*height,x/w*width,height/h]);start=-1;}}}}
 const warning='浏览器使用Pose Landmarker；手部为4点粗略观测，不是Python Holistic的21点手部。多人最多6人，未检测到不代表不存在，请检查。';
 report('识别结果整理完成');return {width,height,parameters:{openpose_json:poses,source_size:{width,height},boundary:{row_spans,person_row_spans,method:'browser_pose_segmentation',matched:!!row_spans.length},holistic:{backend:'browser_pose_landmarker',selected_roi:'group',targets:landmarks.map((p,index)=>({id:'P'+(index+1),native:{coordinate_region_xyxy:[0,0,width,height],pose_landmarks:p}})),warning},browser_model:{...modelInfo,warning,head_reference:'per_person_face_connected_segmentation'}}};
}
let sequence=Promise.resolve();onmessage=event=>{const message=event.data;sequence=sequence.catch(()=>{}).then(async()=>{try{await ready(message.preferred);if(message.type==='init'){postMessage({id:message.id,type:'result',value:modelInfo});return;}const wanted=message.mode==='single'?'single':'multi';if(wanted!==mode){report('正在切换单人识别模式');await engine.setOptions({numPoses:wanted==='single'?1:6});mode=wanted;}report('正在识别人像');const started=performance.now();let value;engine.detect(message.image,result=>value=pack(result,message.width,message.height,message.transform));message.image.close?.();value.parameters.browser_model.preprocess=message.transform;value.parameters.timing={total_ms:Math.round(performance.now()-started),cache_note:'应用内本地推理；图片未上传'};postMessage({id:message.id,type:'result',value});}catch(error){message.image?.close?.();if(/Aborted|memory access|out of bounds|unreachable/i.test(error.message)){try{engine?.close();}catch{}engine=null;modelInfo=null;mode='multi';}postMessage({id:message.id,type:'error',error:error.message});}});};
