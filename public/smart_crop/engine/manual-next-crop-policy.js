/* Shared anatomical protection and source-space framing. Browser + Node. */
(function(root){
  const ratios={'1:1':[1,1],'3:4':[3,4],'2:3':[2,3],'4:3':[4,3],'16:9':[16,9],'9:16':[9,16]};
  const sides=['left','top','right','bottom'];
  const rect=b=>b&&sides.every(k=>Number.isFinite(b[k]))&&b.right>b.left&&b.bottom>b.top;
  const union=bs=>bs.length?{left:Math.min(...bs.map(b=>b.left)),top:Math.min(...bs.map(b=>b.top)),right:Math.max(...bs.map(b=>b.right)),bottom:Math.max(...bs.map(b=>b.bottom))}:null;
  const bound=ps=>ps.length?{left:Math.min(...ps.map(p=>p.x)),top:Math.min(...ps.map(p=>p.y)),right:Math.max(...ps.map(p=>p.x)),bottom:Math.max(...ps.map(p=>p.y))}:null;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function points(v){if(!Array.isArray(v))return [];if(Array.isArray(v[0]))return v.map(p=>({x:+p[0],y:+p[1],s:+(p[2]??1)}));const p=[];for(let i=0;i+2<v.length;i+=3)p.push({x:+v[i],y:+v[i+1],s:+v[i+2]});return p;}
  function clipped(b,w,h){if(!rect(b))return null;const c={left:clamp(b.left,0,w),top:clamp(b.top,0,h),right:clamp(b.right,0,w),bottom:clamp(b.bottom,0,h)};return rect(c)?c:null;}
  // Walk foreground rows connected to the face, inside a head-local corridor.
  // Hand observations are removed before walking, so a raised hand is protected separately.
  function headContour(rows,face,hands,width,height,paddingScale=.85){
    if(!rect(face))return null;const fw=face.right-face.left,fh=face.bottom-face.top,pad=Math.max(fw,fh)*paddingScale;
    const corridor={left:Math.max(0,face.left-pad),right:Math.min(width,face.right+pad),top:0,bottom:Math.min(height,face.bottom+fh*.1)};
    const nodes=[];for(const [x,y,r,t]of rows||[]){if(![x,y,r,t].every(Number.isFinite)||r<=x||t<=0||y>=corridor.bottom)continue;let segments=[[Math.max(x,corridor.left),Math.min(r,corridor.right)]];
      for(const hand of hands)if(y<hand.bottom&&y+t>hand.top)segments=segments.flatMap(([l,r])=>r<=hand.left||l>=hand.right?[[l,r]]:[[l,Math.min(r,hand.left)],[Math.max(l,hand.right),r]]).filter(([l,r])=>r>l);
      for(const [l,r]of segments)if(r>l)nodes.push({left:l,top:Math.max(0,y),right:r,bottom:Math.min(corridor.bottom,y+t)});
    }
    const seeds=[];for(let i=0;i<nodes.length;i++){const n=nodes[i];if(n.top<face.bottom&&n.bottom>face.top&&Math.min(n.right,face.right)-Math.max(n.left,face.left)>=fw*.2)seeds.push(i);}
    const visited=new Set(seeds),queue=[...seeds],near=Math.max(1,fh*.025);
    for(let q=0;q<queue.length;q++){const n=nodes[queue[q]];for(let i=0;i<nodes.length;i++){if(visited.has(i))continue;const b=nodes[i];if(b.top<=n.bottom+near&&b.bottom>=n.top-near&&b.left<=n.right+near&&b.right>=n.left-near){visited.add(i);queue.push(i);}}}
    const connected=queue.map(i=>nodes[i]),box=union(connected);
    if(!rect(box)||box.top>=face.top-Math.max(1,fh*.02))return null;
    return {...box,method:'face_connected_silhouette'};
  }
  function regions(poses,width,height,parameters={},policy={}){
    const warnings=[],parts=[],ids=[],cutoffs=[],valid=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.s>=.35&&p.x>=0&&p.x<=width&&p.y>=0&&p.y<=height;
    const frames=Array.isArray(poses)?poses:[poses||{}],selected=parameters.holistic?.selected_roi,masks=parameters.boundary||parameters.densepose;
    const people=frames.flatMap(f=>f.people||[]).filter(p=>!selected||selected==='group'||!p.person_id||p.person_id===selected);
    for(const [index,person]of people.entries()){
      const id=person.person_id||'P'+(index+1),body=points(person.pose_keypoints_2d),face=points(person.face_keypoints_2d).filter(valid),upper=body.slice(0,8).filter(valid);
      const hip=[body[8],body[11]].filter(valid),neck=valid(body[1])?body[1]:null;
      const center=hip.length?{x:hip.reduce((n,p)=>n+p.x,0)/hip.length,y:hip.reduce((n,p)=>n+p.y,0)/hip.length}:null;
      const dx=center&&neck?center.x-neck.x:0,dy=center&&neck?center.y-neck.y:1,axisLength=Math.hypot(dx,dy)||1;
      const reclining=Math.abs(dx)>Math.abs(dy)*.75;
      const knees=[body[9],body[12]].filter(valid).filter(p=>!center||!neck||((p.x-center.x)*dx+(p.y-center.y)*dy)/axisLength>-.3*axisLength);
      if(!face.length&&upper.length<2){warnings.push(`${id}：上身观测不足，不能建立可靠必保区`);continue;}
      let cutoff=policy.cutoff||'knee_or_visible',end,selectedBody=[...upper,...hip];
      if(cutoff==='waist'&&hip.length)end=Math.min(...hip.map(p=>p.y));
      else if(cutoff==='hip'&&hip.length)end=Math.max(...hip.map(p=>p.y));
      else if(cutoff==='thigh'&&hip.length&&knees.length)end=(Math.max(...hip.map(p=>p.y))+Math.max(...knees.map(p=>p.y)))/2;
      else if(cutoff==='full'){selectedBody=body.slice(0,14).filter(valid);end=Math.max(...selectedBody.map(p=>p.y));}
      else if(knees.length){
        const inset=clamp(Number(policy.knee_inset_fraction)||0,0,.35);
        const tips=knees.map(k=>{const h=k===body[9]?body[8]:body[11],anchor=valid(h)?h:center;return anchor?{...k,x:k.x-(k.x-anchor.x)*inset,y:k.y-(k.y-anchor.y)*inset}:k;});
        end=Math.max(...tips.map(p=>p.y));selectedBody.push(...tips);cutoffs.push({person_id:id,knee_y:Math.max(...knees.map(p=>p.y)),body_end_y:end,inset_fraction:inset});
      }
      else{end=Math.max(...selectedBody.map(p=>p.y));if(end>=height*.9)end=height;warnings.push(`${id}：膝盖未可靠观测，只保留画内可见身体，不外推下半身`);}
      const native=parameters.holistic?.targets?.find(t=>t.id===person.person_id),headBox=face.length?bound(face):bound(upper);
      const faceH=headBox.bottom-headBox.top;
      const handBounds=['hand_left_keypoints_2d','hand_right_keypoints_2d'].map(k=>bound(points(person[k]).filter(valid))).filter(rect).map(b=>({left:b.left-faceH*.04,right:b.right+faceH*.04,top:b.top-faceH*.04,bottom:b.bottom+faceH*.04}));
      const savedHead=native?.head_reference||masks?.head_references?.[id];
      if(savedHead?.truncated_at_local_top)warnings.push(`${id}：头部轮廓触及局部识别图顶部，帽子或头发可能仍不完整`);
      const personRows=masks?.person_row_spans?.[id];
      const contour=face.length?(savedHead?.method==='face_connected_silhouette'&&rect(savedHead)?savedHead:Array.isArray(personRows)?headContour(personRows,headBox,handBounds,width,height,2):people.length===1?headContour(masks?.row_spans,headBox,handBounds,width,height):null):null;
      // Use observed head-local foreground first; face extrapolation is a fallback only.
      let head=face.length?headBox.top-.28*faceH:headBox.top;
      const observedHead=native?.target_roi?.landmarks?.head_y;
      if(contour)head=contour.top;
      else{if(Number.isFinite(observedHead)&&observedHead>=0&&observedHead>=headBox.top-.6*faceH&&observedHead<=headBox.top)head=Math.min(head,observedHead);warnings.push(`${id}：缺少可靠头部相连轮廓，头顶仍为脸部估算，需核对头发和帽子`);}
      head=clamp(head,0,height);
      const bodyRegion=bound(reclining?selectedBody:selectedBody.filter(p=>p.y<=end));
      if(bodyRegion){bodyRegion.top=Math.min(head,bodyRegion.top);if(!reclining)bodyRegion.bottom=Math.min(end,Math.max(bodyRegion.bottom,Math.min(height,end)));if(bodyRegion.right===bodyRegion.left)bodyRegion.right+=1;const b=clipped(bodyRegion,width,height);if(b)parts.push({...b,person_id:id,part:'body'});}
      if(face.length){const b=clipped(contour?union([headBox,contour]):{...headBox,top:head},width,height);if(b)parts.push({...b,person_id:id,part:'head',reference_method:contour?'face_connected_silhouette':'face_estimate'});}
      if(policy.hands!==false)for(const key of ['hand_left_keypoints_2d','hand_right_keypoints_2d']){const hand=points(person[key]).filter(valid);if(hand.length){const b=bound(hand),pad=Math.max(1,faceH*.03);b.left-=pad;b.right+=pad;b.top-=pad;b.bottom+=pad;const c=clipped(b,width,height);if(c)parts.push({...c,person_id:id,part:key});}}
      ids.push(id);
    }
    for(const t of parameters.holistic?.targets||[]){if(ids.includes(t.id)||(selected&&selected!=='group'&&selected!==t.id))continue;const b=t.detector?.box,c=b&&clipped({left:b[0],top:b[1],right:b[2],bottom:b[3]},width,height);if(c){parts.push({...c,person_id:t.id,part:'unresolved_person_detection'});ids.push(t.id);warnings.push(`${t.id}：骨骼识别不足，保守保留检测框；多人景别需人工复核`);}}
    const pixelBoxes=[];
    for(const row of masks?.row_spans||[]){const [x,y,r,thick]=row;if(![x,y,r,thick].every(Number.isFinite))continue;const p=parts.filter(b=>b.part==='body');if(p.some(b=>y>=b.top&&y<=b.bottom)){const c=clipped({left:x,top:y,right:r,bottom:y+Math.max(1,thick)},width,height);if(c&&(!selected||selected==='group'||p.some(b=>c.right>=b.left&&c.left<=b.right)))pixelBoxes.push(c);}}
    // Segmentation protects clothing and hair; no padded detector box is used as anatomy.
    if(pixelBoxes.length){const b=union(pixelBoxes);parts.push({...b,part:'observed_silhouette'});}
    const all=union(parts);if(!rect(all))throw Error('缺少可靠人体参数，无法建立解剖必保区；请先识别或人工标注');
    if(all.left<=0||all.top<=0||all.right>=width||all.bottom>=height)warnings.push('人体必保区触及原图边缘，原图可能已截断；新增背景不等于补全人体');
    const observed=people.flatMap(p=>points(p.pose_keypoints_2d).filter(valid)),observedBounds=bound(observed);
    const axes=people.map(p=>{const b=points(p.pose_keypoints_2d),hips=[b[8],b[11]].filter(valid);if(!valid(b[1])||!hips.length)return null;const dx=hips.reduce((a,p)=>a+p.x,0)/hips.length-b[1].x,dy=hips.reduce((a,p)=>a+p.y,0)/hips.length-b[1].y;return {x:dx,y:dy,reclining:Math.abs(dx)>Math.abs(dy)*.75};}).filter(Boolean);
    return {bounds:all,parts,warnings,person_ids:ids,mask_boxes:pixelBoxes,method:'observed_anatomy_body_axis',cutoff:policy.cutoff||'knee_or_visible',cutoff_references:cutoffs,measurements:{observed_body_bounds:observedBounds,body_bbox_fraction:rect(observedBounds)?(observedBounds.right-observedBounds.left)*(observedBounds.bottom-observedBounds.top)/width/height:null,max_span_fraction:rect(observedBounds)?Math.max((observedBounds.right-observedBounds.left)/width,(observedBounds.bottom-observedBounds.top)/height):null,reclining:axes.some(a=>a.reclining),axes,basis:'observed_skeleton_bbox_not_silhouette_area'}};
  }
  function intersection(a,b){return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));}
  function canvas(box,w,h){const area=(box.right-box.left)*(box.bottom-box.top),known=intersection(box,{left:0,top:0,right:w,bottom:h});return {missing_area_fraction:1-known/area,extension_px:{left:Math.max(0,-box.left),top:Math.max(0,-box.top),right:Math.max(0,box.right-w),bottom:Math.max(0,box.bottom-h)}};}
  const avoidanceLimit=strength=>strength==='required'?0:strength==='moderate'?.3:.8;
  // Union of clipped rectangles: overlapping joints/corridors count only once.
  function overlapArea(zone,parts){
    const boxes=parts.map(p=>({left:Math.max(zone.left,p.left),right:Math.min(zone.right,p.right),top:Math.max(zone.top,p.top),bottom:Math.min(zone.bottom,p.bottom)})).filter(rect);
    const events=boxes.flatMap((box,id)=>[{y:box.top,id,box,add:true},{y:box.bottom,id,box,add:false}]).sort((a,b)=>a.y-b.y),active=new Map;let area=0,previous=events[0]?.y||0;
    for(let i=0;i<events.length;){const y=events[i].y,intervals=[...active.values()].map(p=>[p.left,p.right]).sort((a,b)=>a[0]-b[0]);let end=-Infinity,width=0;for(const [left,right]of intervals){width+=Math.max(0,right-Math.max(left,end));end=Math.max(end,right);}area+=(y-previous)*width;while(i<events.length&&events[i].y===y){const event=events[i++];if(event.add)active.set(event.id,event.box);else active.delete(event.id);}previous=y;}return area;
  }
  function bodyContourParts(parameters,width,height){return ((parameters.boundary||parameters.densepose)?.row_spans||[]).filter(row=>row.length>=4&&row.slice(0,4).every(Number.isFinite)&&row[2]>row[0]&&row[3]>0).map(([left,top,right,thickness])=>clipped({left,top,right,bottom:top+thickness},width,height)).filter(rect).map(box=>({...box,part:'body_contour'}));}
  function avoidanceChecks(zones,targets){return zones.map((zone,i)=>{const target=targets[i],overlap=overlapArea(zone,target.parts),ratio=Math.min(1,overlap/Math.max(1,(zone.right-zone.left)*(zone.bottom-zone.top))),limit=avoidanceLimit(target.strength);return {index:i,strength:target.strength,required:target.strength==='required',overlap,overlap_ratio:ratio,allowed_overlap:limit,target_met:ratio<=limit+1e-6};});}
  function avoidanceRank(checks){return ['required','moderate','preferred'].map(strength=>checks.filter(z=>!z.ignored&&z.strength===strength).reduce((n,z)=>n+Math.max(0,z.overlap_ratio-z.allowed_overlap),0));}
  function compareRanks(a,b){for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-6)return a[i]<b[i]?-1:1;return 0;}
  function directionalChoice(candidates,budget){
    if(!candidates.length)return null;
    const minimumLoss=Math.min(...candidates.map(c=>c.reference_loss||0));candidates=candidates.filter(c=>(c.reference_loss||0)<=minimumLoss+1e-9);
    const within=candidates.filter(c=>c.ext<=budget+1e-9),minimum=Math.min(...candidates.map(c=>c.ext));
    const base=within.length?within:candidates.filter(c=>c.ext<=minimum+1e-9);
    let pool=base;const ignored=new Map,unreachable=new Set,accepted=[];
    for(let i=0;i<base[0].checks.length;i++){
      const meets=c=>c.checks[i].target_met,feasible=pool.filter(meets);
      if(feasible.length){pool=feasible;accepted.push(i);continue;}
      if(accepted.length&&base.some(meets)){ignored.set(i,[...accepted]);continue;}
      unreachable.add(i);const best=Math.min(...pool.map(c=>c.checks[i].overlap_ratio));
      pool=pool.filter(c=>c.checks[i].overlap_ratio<=best+1e-9);accepted.push(i);
    }
    const answer=pool.reduce((best,c)=>!best||compareRanks([c.ext,c.distance],[best.ext,best.distance])<0?c:best,null);
    answer.checks=answer.checks.map((z,i)=>({...z,ignored:ignored.has(i),ignored_by:ignored.get(i)||[],direction_status:ignored.has(i)?'axis_conflict':unreachable.has(i)?'axis_unreachable':'active'}));
    return answer;
  }
  function plan({width,height,poses,parameters={},preset={},aspect=preset.cropAspect||'free',allowVirtual=false,requiredRegions=null}){
    if(preset.aspect_profiles?.[aspect])preset={...preset,...preset.aspect_profiles[aspect],regions:{...preset.regions,...preset.aspect_profiles[aspect].regions}};
    const anatomy=requiredRegions||regions(poses,width,height,parameters,preset.protection_policy||{}),R=anatomy.bounds,warnings=[...(anatomy.warnings||[])],frac={},abs={};
    const heads=anatomy.parts.filter(p=>p.part==='head'),headTop=heads.length?Math.min(...heads.map(p=>p.top)):R.top;
    for(const side of sides){const m=preset.margins?.[side]||{value:0,unit:'percent',basis:'crop',relation:'min'},n=Number(m.value)||0,horizontal=side==='left'||side==='right';frac[side]=0;abs[side]=0;if(n<0)throw Error('留白不能为负数');if(m.unit==='px'){const out=horizontal?preset.output?.width:preset.output?.height;if(n&&!out)throw Error('像素留白需要指定相应输出尺寸');frac[side]=out?n/out:0;}else if(m.basis==='source')abs[side]=n/100*(horizontal?width:height);else frac[side]=n/100;}
    if(frac.left+frac.right>=1||frac.top+frac.bottom>=1)throw Error('留白之和必须小于画幅尺寸');
    const a=aspect==='free'?null:ratios[aspect]||(/^[1-9]\d{0,4}:[1-9]\d{0,4}$/.test(aspect)?[Number(aspect.split(':')[0])/Number(aspect.split(':')[1]),1]:null);if(aspect!=='free'&&!a)throw Error('不支持的比例');
    const minW=(R.right-R.left+abs.left+abs.right)/(1-frac.left-frac.right),minH=Math.max((R.bottom-headTop+abs.top+abs.bottom)/(1-frac.top-frac.bottom),(R.bottom-R.top+abs.bottom)/(1-frac.bottom));
    const direction=preset.composition?.movement_axis||'free',directional=direction!=='free';
    let W,H;if(direction==='horizontal'){H=height;W=H*(a?a[0]/a[1]:width/height);}else if(direction==='vertical'){W=width;H=W/(a?a[0]/a[1]:width/height);}else if(a){const unit=Math.ceil(Math.max(minW/a[0],minH/a[1]));W=unit*a[0];H=unit*a[1];}else{W=Math.ceil(minW);H=Math.ceil(minH);}
    const context=preset.composition?.adaptive_context,m=anatomy.measurements||{},small=Number.isFinite(m.body_bbox_fraction)&&m.body_bbox_fraction<(context?.small_subject_fraction??.18)&&m.max_span_fraction<.75;
    let contextApplied=false,contextScale=1;
    if(!directional&&context?.enabled&&small&&W<=width&&H<=height){const ratio=W/H,maxW=Math.min(width,height*ratio),factor=Math.max(1,Number(m.body_bbox_fraction<(context.tiny_subject_fraction??.01)?context.tiny_subject_scale||context.scale:context.scale)||1.25);let cw=Math.min(W*factor,maxW);if(a){const units=Math.floor(cw/a[0]);cw=Math.max(W,units*a[0]);}if(cw>W+.1){H=cw/ratio;W=cw;contextApplied=true;contextScale=factor;}}
    const requestedScale=Math.max(1,Math.min(1.25,Number(preset.composition?.minimum_scale)||1));if(!directional&&requestedScale>1){if(a){const units=Math.ceil(W*requestedScale/a[0]);W=units*a[0];H=units*a[1];}else{W=Math.ceil(W*requestedScale);H=Math.ceil(H*requestedScale);}}
    if(W*H>64000000||Math.max(W,H)>32768)throw Error('必要画布超出导出限制，请检查留白与必保条件');
    if(!directional&&!allowVirtual&&(W>width||H>height))throw Error('原图内无法同时满足必保区、留白和比例；请换比例或允许有限外扩');
    let loX=R.right+abs.right+frac.right*W-W,hiX=R.left-abs.left-frac.left*W,loY=R.bottom+abs.bottom+frac.bottom*H-H,hiY=Math.min(R.top,headTop-abs.top-frac.top*H);
    if(directional){if(direction==='horizontal'){loY=hiY=0;if(R.top<0||R.bottom>height)warnings.push('横移保留原图上下边界，竖向参照超出原图的部分无法补全');}else{loX=hiX=0;if(R.left<0||R.right>width)warnings.push('纵移保留原图左右边界，横向参照超出原图的部分无法补全');}if(loX>hiX){[loX,hiX]=[hiX,loX];warnings.push('该比例的横向空间不足，优先保留最多身体参照，不改变上下边界');}if(loY>hiY){[loY,hiY]=[hiY,loY];warnings.push('该比例的竖向空间不足，优先保留最多身体参照，不改变左右边界');}if(!allowVirtual&&(W>width||H>height))warnings.push('当前比例在锁定方向下需要外扩，已给出最小外扩候选，请确认');}
    const best=(lo,hi,dim,extent,preferred)=>{const insideLo=dim<=extent?0:extent-dim,insideHi=dim<=extent?extent-dim:0;const low=Math.max(lo,insideLo),high=Math.min(hi,insideHi);return low<=high?clamp(preferred,low,high):clamp(preferred,lo,hi);};
    // Extra aspect-ratio height goes below the required body, not above the head.
    const slackY=Math.max(0,hiY-loY),share=contextApplied&&preset.margins?.top?.relation!=='exact'?(m.reclining?(context.reclining_top_share??.5):(context.upright_top_share??.2)):0;
    const focus=preset.composition?.focus_source;
    const prefX=directional?(R.left+R.right-W)/2:focus?focus.x-W*.5:(R.left+R.right-W)/2,prefY=directional?(R.top+R.bottom-H)/2:focus?focus.y-H*(preset.composition.focus_y_fraction??.45):!contextApplied&&preset.composition?.compact_anchor==='required_bottom'?loY:hiY-slackY*share,x=direction==='vertical'?0:best(loX,hiX,W,width,prefX),y=direction==='horizontal'?0:best(loY,hiY,H,height,prefY);
    const avoid=preset.regions?.avoid||[],xs=[x,loX,hiX],ys=[y],modern=!!preset.composition?.avoidance_thresholds,onlyPreferred=modern&&anatomy.avoid_targets?.length&&anatomy.avoid_targets.every(z=>z.strength==='preferred');
    for(const q of avoid){xs.push(clamp(R.left-q.right*W,loX,hiX),clamp(R.right-q.left*W,loX,hiX));for(const h of heads)xs.push(clamp(h.left-q.right*W,loX,hiX),clamp(h.right-q.left*W,loX,hiX));}
    if(anatomy.avoid_targets)for(const [i,q]of avoid.entries())for(const p of [union(anatomy.avoid_targets[i].parts)].filter(Boolean)){xs.push(clamp(p.left-q.right*W,loX,hiX),clamp(p.right-q.left*W,loX,hiX));ys.push(clamp(p.top-q.bottom*H,loY,hiY),clamp(p.bottom-q.top*H,loY,hiY));}
    if(modern&&avoid.length){const range=onlyPreferred?.03:1;for(let i=0;i<=8;i++){xs.push(clamp(onlyPreferred?x+W*range*(i/4-1):loX+(hiX-loX)*i/8,loX,hiX));ys.push(clamp(onlyPreferred?y+H*range*(i/4-1):loY+(hiY-loY)*i/8,loY,hiY));}}
    const candidates=[];
    const xValues=direction==='vertical'?[x]:[...new Set(xs)],yValues=direction==='horizontal'?[y]:[...new Set(ys)];
    if(directional){const values=direction==='horizontal'?xValues:yValues,lo=direction==='horizontal'?loX:loY,hi=direction==='horizontal'?hiX:hiY;for(let i=0;i<=64;i++)values.push(lo+(hi-lo)*i/64);}
    let answer=null;
    for(const cx of xValues)for(const cy of yValues){
      if(!allowVirtual&&!(directional&&(W>width||H>height))&&(cx<-.001||cy<-.001||cx+W>width+.001||cy+H>height+.001))continue;
      if(modern&&onlyPreferred&&(Math.abs(cx-x)>W*.030001||Math.abs(cy-y)>H*.030001))continue;
      const b={left:cx,top:cy,right:cx+W,bottom:cy+H},zones=avoid.map(q=>({left:cx+q.left*W,top:cy+q.top*H,right:cx+q.right*W,bottom:cy+q.bottom*H})),ext=canvas(b,width,height).missing_area_fraction;
      if(modern){
        const checks=avoidanceChecks(zones,anatomy.avoid_targets),budget=preset.composition.avoidance_budget??1,rank=[Math.max(0,ext-budget),...avoidanceRank(checks),ext,Math.hypot((cx-x)/W,(cy-y)/H)];
        const candidate={crop:b,zones,overlap:checks.reduce((n,z)=>n+z.overlap,0),headOverlap:checks.filter(z=>z.required).reduce((n,z)=>n+z.overlap,0),checks,rank,ext,reference_loss:1-intersection(b,R)/((R.right-R.left)*(R.bottom-R.top)),distance:Math.hypot((cx-x)/W,(cy-y)/H)};
        if(directional)candidates.push(candidate);if(!answer||compareRanks(rank,answer.rank)<0)answer=candidate;
      }else{
        const observed=anatomy.mask_boxes?.length?[...anatomy.mask_boxes,...anatomy.parts.filter(p=>p.part!=='body'&&p.part!=='observed_silhouette')]:anatomy.parts;
        let overlap=zones.reduce((sum,z)=>sum+observed.reduce((a,p)=>a+intersection(z,p),0),0),headOverlap=zones.reduce((sum,z)=>sum+heads.reduce((a,p)=>a+intersection(z,p),0),0);
        if(anatomy.avoid_targets){overlap=0;headOverlap=0;for(const [i,z]of zones.entries()){const hit=anatomy.avoid_targets[i].parts.reduce((n,p)=>n+intersection(z,p),0);overlap+=hit;if(anatomy.avoid_targets[i].required)headOverlap+=hit;}}
        const score=ext*1e9+overlap+Math.abs(cx-x)*.01;
        if(!answer||headOverlap<answer.headOverlap-.001||Math.abs(headOverlap-answer.headOverlap)<=.001&&score<answer.score)answer={crop:b,zones,score,overlap,headOverlap};
      }
    }
    if(directional&&modern)answer=directionalChoice(candidates,!allowVirtual?0:preset.composition.avoidance_budget??1);
    if(!answer)throw Error('当前边界约束无法满足');
    if(!contextApplied&&preset.composition?.compact_anchor==='required_bottom'){
      const crossed=(anatomy.cutoff_references||[]).filter(c=>c.inset_fraction>0&&answer.crop.bottom>=c.knee_y);
      if(crossed.length)warnings.push(`比例或其他必保约束使底边仍达到 ${crossed.map(c=>c.person_id).join('、')} 的膝盖，严格膝上景别未满足，需调整比例或人工复核`);
    }
    if(!modern&&answer.headOverlap>0)warnings.push('Logo避让区仍与头部轮廓参考范围冲突，请人工调整；没有通过扩大画布尺寸消除冲突');
    if(!modern&&answer.overlap>0)warnings.push('Logo避让区与已观测人体范围可能冲突，保留最小必要画布并提示复核，不为避让自动扩大画布');
    if(preset.regions?.protection?.length)warnings.push('旧模板画幅绿色框仅作来源证据，已忽略固定槽位，必保区按当前人体重建');
    const actual={};for(const side of sides){const gap=side==='left'?R.left-answer.crop.left:side==='top'?headTop-answer.crop.top:side==='right'?answer.crop.right-R.right:answer.crop.bottom-R.bottom,dim=side==='left'||side==='right'?W:H,m=preset.margins?.[side];actual[side]={source_px:gap,percent:gap/dim*100,output_px:(side==='left'||side==='right'?preset.output?.width:preset.output?.height)?gap/dim*(side==='left'||side==='right'?preset.output.width:preset.output.height):null};if(m?.relation==='exact'){const expected=m.unit==='px'?actual[side].output_px:m.basis==='source'?gap/(side==='left'||side==='right'?width:height)*100:actual[side].percent;if(expected===null||Math.abs(expected-m.value)>(m.unit==='px'?.5:.1))warnings.push(`${side} 精确留白与比例／必保条件冲突，当前未满足精确值`);}}
    return {engine:preset.engine||'anatomy-v2',directional_avoid_checks:directional?answer.checks:null,movement:directional?{axis:direction,full_source_axis:true,locked_size:[W,H],source_delta:{x:x-answer.crop.left,y:y-answer.crop.top},baseline:{left:x,top:y,right:x+W,bottom:y+H}}:null,head_reference:{top:headTop,basis:heads.length?'head_parts':'required_bounds_fallback',required_top:R.top},composition:{mode:contextApplied?'environment_context':'compact',measurements:m,scale:contextApplied?contextScale:1,reclining:!!m.reclining,decision:'deterministic_candidate_not_random'},crop:answer.crop,anatomy,avoid_regions:answer.zones,canvas:canvas(answer.crop,width,height),margins:actual,warnings:[...new Set(warnings)],review_required:!!warnings.length||(modern?answer.checks.some(z=>!z.target_met):answer.overlap>0),avoid_overlap:answer.overlap,head_avoid_overlap:answer.headOverlap,aspect};
  }
  function preset({aspect='3:4',avoid=[],margins=null,scene='膝上'}={}){const cutoff=/全身/.test(scene)?'full':/腰/.test(scene)?'waist':/胯/.test(scene)?'hip':/大腿/.test(scene)?'thigh':'knee_or_visible';return {engine:'anatomy-v2',cropAspect:aspect,output:{width:0,height:0},margins:margins||Object.fromEntries(sides.map(s=>[s,{value:s==='top'?3:s==='bottom'?1:2,unit:'percent',basis:'crop',relation:'min'}])),regions:{basis:'crop_fraction',protection:[],avoid},protection_policy:{basis:'current_body_anatomy',cutoff,head:true,hands:true,missing_body:'visible_only',legacy_canvas_protection:'evidence_only'},composition:{vertical_anchor:'required_top',extension:'minimum_required',avoid_conflict:'report_without_growth'}};}
  const api={regions,plan,preset,union,clipped,points,rect,canvas,bodyContourParts,overlapArea,avoidanceChecks,avoidanceRank,compareRanks,avoidanceLimit,directionalChoice};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.AnatomyCrop=api;
})(typeof globalThis!=='undefined'?globalThis:this);
