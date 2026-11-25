/* Declarative manual rules -> shared AnatomyCrop solver. No image inference here. */
(function(root){
  const A=root.AnatomyCrop||(typeof require==='function'?require('./manual-next-crop-policy.js'):null);
  const ends={shoulders:'肩膀',waist_hip:'腰胯之间',hip:'胯部',below_hip:'胯部稍下',mid_thigh:'胯膝中点',above_knee:'膝上',knee:'膝盖',calf:'腿肚',ankle:'脚踝',soles:'脚底'};
  const starts={head:'头部',shoulders:'肩部',above_waist:'腰部稍上',hip:'胯部',above_knee:'膝上',knee:'膝盖',calf:'腿肚',ankle:'脚踝'};
  function defaults(){return {schema:'manual-crop/v1',name:'秋冬套装 · 膝上紧凑',category:'套装',estimation:{enabled:true,auto_downgrade:true,canvas_fallback:true},aspect:'3:4',framing:{start:'head',end:'above_knee'},protection:{start:'head',end:'hip',hands:'prefer_one',preference_extension_limit:.15},avoid_regions:[{name:'左上 Logo',enabled:true,target:'head_contour',strength:'required',box:{left:.03,top:.02,right:.2,bottom:.15}},{name:'左下文案',enabled:false,target:'body_contour',strength:'moderate',box:{left:.03,top:.58,right:.61,bottom:.96}}],balance:{enabled:true,diagonal_degrees:15,horizontal_degrees:60,horizontal_top_percent:20,diagonal_shift_percent:5},spacing:{unit:'percent',top:3,right:2,bottom:3,left:2},output:{width:900,height:1200},allow_virtual:true,max_extension_fraction:.25};}
  function avoidZones(r){return r.avoid_regions||[r.avoid];}
  function spacingUnit(r,side){return r.spacing.units?.[side]||r.spacing.unit;}
  function validate(r){
    if(r?.schema!=='manual-crop/v1')throw Error('规则版本必须是 manual-crop/v1');
    if(!['free','horizontal','vertical'].includes(r.avoidance_motion||'free'))throw Error('未知避让方向');
    if(r.avoidance_frame&&(!/^[1-9]\d{0,4}:[1-9]\d{0,4}$/.test(r.avoidance_frame.aspect)||!['width_fraction','left_fraction','top_fraction'].every(k=>Number.isFinite(r.avoidance_frame[k]))||r.avoidance_frame.width_fraction<=0||r.avoidance_frame.width_fraction>40))throw Error('无效方向锁定画幅');
    if(typeof r.name!=='string'||!r.name.trim()||r.name.length>120)throw Error('模板名称需为1–120字符');
    if(!Object.hasOwn(starts,r.framing?.start)||!Object.hasOwn(ends,r.framing?.end)||!Object.hasOwn(starts,r.protection?.start)||!Object.hasOwn(ends,r.protection?.end))throw Error('未知身体参照');
    for(const spec of [r.framing,r.protection])for(const key of ['startOffset','endOffset'])if(spec?.[key]!==undefined&&(!Number.isFinite(spec[key])||spec[key]<-1||spec[key]>1))throw Error(`${key} 必须在 -1 到 1 个肩胯长度之间`);
    if(!['none','prefer_one','prefer_all','require_one','require_all'].includes(r.protection.hands))throw Error('未知手部保护方式');
    for(const side of ['top','right','bottom','left'])if(!Number.isFinite(r.spacing?.[side])||r.spacing[side]<0)throw Error('留白必须是非负数字');
    if(!['percent','px'].includes(r.spacing.unit))throw Error('留白单位必须为 percent 或 px');
    if(!Array.isArray(avoidZones(r))||avoidZones(r).length>12)throw Error('避让区域最多12个');
    for(const z of avoidZones(r)){if(!['head_contour','skeleton','body_contour'].includes(z?.target)||!['required','moderate','preferred'].includes(z?.strength))throw Error('未知避让策略');if(!A.rect(z.box)||Object.values(z.box).some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('避让区域需为成片内0–1矩形');}
    for(const side of ['top','right','bottom','left'])if(!['percent','px'].includes(spacingUnit(r,side)))throw Error('未知侧边留白单位');
    if(!Number.isFinite(r.max_extension_fraction)||r.max_extension_fraction<0||r.max_extension_fraction>.8)throw Error('外扩面积上限需在0–80%之间');
    if(!Number.isFinite(r.protection.preference_extension_limit)||r.protection.preference_extension_limit<0||r.protection.preference_extension_limit>1)throw Error('偏好扩张预算需在0–100%之间');
    if(!(r.balance.diagonal_degrees>0&&r.balance.horizontal_degrees>r.balance.diagonal_degrees&&r.balance.horizontal_degrees<=90)||!(r.balance.horizontal_top_percent>=0&&r.balance.horizontal_top_percent<80)||!(r.balance.diagonal_shift_percent>=0&&r.balance.diagonal_shift_percent<=30))throw Error('构图角度或留白参数超出范围');
    if(!/^[1-9]\d{0,4}:[1-9]\d{0,4}$/.test(r.aspect))throw Error('未知画幅');
    if(r.spacing.unit==='px'&&!(r.output.width>0&&r.output.height>0))throw Error('像素留白必须指定输出宽高');
    if(!['width','height'].every(k=>Number.isInteger(r.output[k])&&r.output[k]>0&&r.output[k]<=16000)||r.output.width*r.output.height>64000000)throw Error('输出需为正整数且不超过64MP');
    if(r.output.width>0&&r.output.height>0&&r.output.width*Number(r.aspect.split(':')[1])!==r.output.height*Number(r.aspect.split(':')[0]))throw Error('输出宽高必须与画幅一致');
    return r;
  }
  const valid=p=>p&&p.s>=.35&&Number.isFinite(p.x)&&Number.isFinite(p.y);
  const mean=ps=>({x:ps.reduce((n,p)=>n+p.x,0)/ps.length,y:ps.reduce((n,p)=>n+p.y,0)/ps.length,s:1});
  const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,s:Math.min(a.s,b.s)});
  const box=ps=>({left:Math.min(...ps.map(p=>p.x)),right:Math.max(...ps.map(p=>p.x))+1,top:Math.min(...ps.map(p=>p.y)),bottom:Math.max(...ps.map(p=>p.y))+1});
  function solveCandidate({rule,width,height,poses,parameters={}}){
    validate(rule);const warnings=[],trace=[],all=[],desired=[],hands=[],heads=[],skeleton=[],angles=[],focuses=[],estimated=[],estimatedHeads=[];
    const base=A.regions(poses,width,height,parameters,{cutoff:'full',hands:false});
    const people=(Array.isArray(poses)?poses:[poses]).flatMap(f=>f.people||[]);
    const boundary=parameters.boundary||parameters.densepose||{},rows=boundary.row_spans||[],bodyContour=A.bodyContourParts(parameters,width,height);if(avoidZones(rule).some(z=>z.enabled&&z.target==='body_contour')&&!bodyContour.length)warnings.push('缺少身体轮廓数据，本次暂按粗略骨骼避让；请重新识别完整轮廓后复核');
    for(const [i,p]of people.entries()){
      const id=p.person_id||'P'+(i+1),personRows=boundary.person_row_spans?.[id]||rows,clothesRows=boundary.person_part_row_spans?.[id]?.clothes||[],b=A.points(p.pose_keypoints_2d).map(q=>q.x>=0&&q.x<=width&&q.y>=0&&q.y<=height?q:{...q,s:0}),hipPoints=[b[8],b[11]].filter(valid),shoulders=[b[2],b[5]].filter(valid);
      if(!shoulders.length||!hipPoints.length&&!(rule.framing.end==='shoulders'&&rule.protection.end==='shoulders')){warnings.push(`${id}：肩或胯不可用，不能可靠执行身体分段`);continue;}
      const shoulder=mean(shoulders),faceAxis=valid(b[0])?b[0]:{x:shoulder.x,y:shoulder.y-1},hip=hipPoints.length?mean(hipPoints):{x:shoulder.x+(shoulder.x-faceAxis.x),y:shoulder.y+Math.max(1,shoulder.y-faceAxis.y)},axis={x:hip.x-shoulder.x,y:hip.y-shoulder.y},len=Math.hypot(axis.x,axis.y);
      if(len<2){warnings.push(`${id}：躯干轴过短`);continue;}
      const u={x:axis.x/len,y:axis.y/len},project=q=>(q.x-shoulder.x)*u.x+(q.y-shoulder.y)*u.y;
      const angle=Math.atan2(Math.abs(axis.x),Math.abs(axis.y))*180/Math.PI;angles.push(angle);
      const markedHead=parameters.manual_review_heads?.find(h=>h.person_id===id);let head=markedHead?{...markedHead,part:'head',reference_method:'manual_review'}:base.parts.find(q=>q.part==='head'&&q.person_id===id);
      if(!head&&rule.estimation?.enabled!==false&&shoulders.length===2){
        const shoulderWidth=Math.hypot(shoulders[0].x-shoulders[1].x,shoulders[0].y-shoulders[1].y),scale=Math.max(shoulderWidth,len*.6),hw=scale*.7,hh=scale*.9;
        const coarse=[b[0],b[14],b[15],b[16],b[17]].filter(valid),center=coarse.length?mean(coarse):{x:shoulder.x-u.x*scale*.65,y:shoulder.y-u.y*scale*.65};
        const raw={left:center.x-hw/2,top:center.y-hh*.6,right:center.x+hw/2,bottom:center.y+hh*.4};
        head={...(rule.allow_virtual?raw:A.clipped(raw,width,height)),part:'head',person_id:id,reference_method:'shoulder_proportion_estimate'};
        if(A.rect(head)){estimatedHeads.push(head);warnings.push(`${id} 头部为肩宽/躯干与鼻眼点比例估计，非轮廓观测；头发、帽子需人工复核`);}else head=null;
      }
      if(markedHead)warnings.push(`${id} 头部参照来自人工标记`);if(head)heads.push(head);
      const native=parameters.holistic?.targets?.find(t=>t.id===id)?.native;
      const nativeRegion=native?.coordinate_region_xyxy||[0,0,width,height];
      function foot(side){const ps=[side===0?29:30,side===0?31:32].map(k=>native?.pose_landmarks?.[k]).filter(q=>q&&q.visibility>=.35&&q.x>=0&&q.x<=1&&q.y>=0&&q.y<=1).map(q=>({x:nativeRegion[0]+q.x*(nativeRegion[2]-nativeRegion[0]),y:nativeRegion[1]+q.y*(nativeRegion[3]-nativeRegion[1]),s:q.visibility}));return ps.length?ps.reduce((a,q)=>project(q)>project(a)?q:a):null;}
      function start(key){
        if(key==='head'){if(!head)throw Error(`${id} 缺少头部观测，含头景别需人工确认`);return {x:(head.left+head.right)/2,y:head.top,s:1};}
        if(key==='shoulders')return shoulder;
        if(key==='hip')return hip;
        if(key==='above_waist'){warnings.push('腰部以肩胯连线约65%处估算，腰上参照取55%处，需按服装复核');return lerp(shoulder,hip,.55);}
        return end(key,'start');
      }
      function fromKnee(side,fraction,label){
        if(rule.estimation?.enabled===false||angle>35||u.y<=0||hipPoints.length<2||shoulders.length<2)return null;
        const h=b[side?11:8],k=b[side?12:9];if(!valid(h)||!valid(k))return null;
        const dx=k.x-h.x,dy=k.y-h.y,thigh=Math.hypot(dx,dy);if(thigh<len*.5||thigh>len*1.5||(dx*u.x+dy*u.y)/thigh<.7)return null;
        const shin=thigh*.95,q={x:k.x+dx/thigh*shin*fraction,y:k.y+dy/thigh*shin*fraction,s:1};
        const extra=rule.allow_virtual?.25:0;if(q.x< -width*extra||q.x>width*(1+extra)||q.y< -height*extra||q.y>height*(1+extra))return null;
        if(!estimated.some(e=>e.person_id===id&&e.kind===label&&e.side===side)){estimated.push({...q,person_id:id,kind:label,side,from:k});warnings.push(`${id} ${side?'左':'右'}${label}从已观测膝盖延伸估算；小腿长度暂取大腿长度95%，需人工复核`);}return q;
      }
      function leg(side,kind){const index=side?(kind==='knee'?12:13):(kind==='knee'?9:10),existing=b[index];if(valid(existing))return existing;
        if(rule.estimation?.enabled===false||angle>35||u.y<=0||hipPoints.length<2||shoulders.length<2)return null;
        const h=b[side?11:8];if(!valid(h))return null;if(kind==='ankle'&&valid(b[side?12:9]))return fromKnee(side,1,'脚踝');const ankle=b[side?13:10];let q=kind==='knee'&&valid(ankle)?lerp(h,ankle,.5):{x:h.x+u.x*len*(kind==='knee'?.95:1.9),y:h.y+u.y*len*(kind==='knee'?.95:1.9),s:1};
        const outside=q.x<0||q.x>width||q.y<0||q.y>height;if(outside&&(!rule.allow_virtual||q.x< -width*.25||q.x>width*1.25||q.y< -height*.25||q.y>height*1.25))return null;
        if(!estimated.some(e=>e.person_id===id&&e.index===index)){estimated.push({...q,person_id:id,index,from:h,kind:kind==='knee'?'膝盖':'脚踝'});warnings.push(`${id} ${side?'左':'右'}${kind==='knee'?'膝盖':'脚踝'}为肩胯比例估算，并非模型观测，需人工确认`);}return q;}
      function end(key,edge='end'){if(key==='shoulders')return shoulders.reduce((a,q)=>(edge==='start'?project(q)<project(a):project(q)>project(a))?q:a);if(key==='hip')return hip;if(key==='waist_hip'){warnings.push('腰胯中间位置为肩胯比例估算');return lerp(shoulder,hip,.82);}const tips=[];for(let side=0;side<2;side++){const h=b[side?11:8],k=['below_hip','mid_thigh','above_knee','knee','calf'].includes(key)?leg(side,'knee'):b[side?12:9],a=['ankle','soles'].includes(key)?leg(side,'ankle'):b[side?13:10];if(!valid(h))continue;if(key==='below_hip'&&valid(k))tips.push(lerp(h,k,.15));if(['mid_thigh','above_knee','knee'].includes(key)&&valid(k))tips.push(lerp(h,k,key==='mid_thigh'?.5:key==='above_knee'?.72:1));if(key==='calf'){let calf=valid(k)&&valid(a)?lerp(k,a,.55):fromKnee(side,.55,'腿肚');if(!calf&&!valid(b[side?12:9])&&valid(k)){const ankle=leg(side,'ankle');if(valid(ankle))calf=lerp(k,ankle,.55);}if(calf)tips.push(calf);}if(key==='ankle'&&valid(a))tips.push(a);if(key==='soles'){let f=foot(side);if(!f&&valid(a)&&rule.estimation?.enabled!==false&&angle<=35){const q={x:a.x+u.x*len*.12,y:a.y+u.y*len*.12,s:1};if(q.x>=-width*(rule.allow_virtual?.25:0)&&q.x<=width*(rule.allow_virtual?1.25:1)&&q.y>=0&&q.y<=height*(rule.allow_virtual?1.25:1)){f=q;estimated.push({...q,from:a,person_id:id,kind:'脚底'});warnings.push(`${id} 脚底为脚踝沿身体轴的比例估计，非鞋底轮廓观测`);}}if(f)tips.push(f);}}
        if(!tips.length)throw Error(`${id} 缺少“${ends[key]}”可靠观测；观测不足且不满足安全估算条件，请选择更短景别或人工确认`);return tips.reduce((a,q)=>(edge==='start'?project(q)<project(a):project(q)>project(a))?q:a);}
      function range(spec,label){const rawFrom=start(spec.start),rawTo=end(spec.end),startOffset=Number(spec.startOffset||0),endOffset=Number(spec.endOffset||0),from={...rawFrom,x:rawFrom.x+u.x*len*startOffset,y:rawFrom.y+u.y*len*startOffset},to={...rawTo,x:rawTo.x+u.x*len*endOffset,y:rawTo.y+u.y*len*endOffset},low=project(from),high=project(to);if(high<=low)throw Error(`${label}顺序与躯干方向冲突`);
        const selected=b.slice(0,14).filter(valid).filter(q=>project(q)>=low&&project(q)<=high);selected.push(from,to);if(spec.end==='shoulders')selected.push(...shoulders);if(spec.start==='head'&&head)selected.push({x:head.left,y:head.top},{x:head.right,y:head.bottom});
        const bounds=box(selected),margin=len*.12;bounds.left-=margin;bounds.right+=margin;
        // Restrict silhouette rows to this person's anatomical corridor and axial slice.
        const mask=personRows.flatMap(([x,y,r,t])=>{const l=Math.max(x,bounds.left),right=Math.min(r,bounds.right),q={x:(l+right)/2,y:y+t/2};return right>l&&project(q)>=low&&project(q)<=high?[{left:l,top:y,right,bottom:y+t,part:'silhouette',person_id:id}]:[];});
        const garment=clothesRows.flatMap(([x,y,r,t])=>{const q={x:(x+r)/2,y:y+t/2};return r>x&&project(q)>=low&&project(q)<=high?[{left:x,top:y,right:r,bottom:y+t,part:'clothes_contour',person_id:id}]:[];});
        const result={...A.union([bounds,...mask,...garment]),part:label,person_id:id};return result;}
      const core=range(rule.protection,'core'),frame=range(rule.framing,'framing');all.push(core);desired.push(frame);
      focuses.push(head?{x:((head.left+head.right)/2+shoulder.x)/2,y:((head.top+head.bottom)/2+shoulder.y)/2}:shoulder);
      for(const key of ['hand_left_keypoints_2d','hand_right_keypoints_2d']){const ps=A.points(p[key]).filter(valid);if(ps.length>=3)hands.push({...box(ps),person_id:id,part:'hand'});}
      for(const q of b.filter(valid))skeleton.push({left:q.x-len*.04,right:q.x+len*.04,top:q.y-len*.04,bottom:q.y+len*.04,part:'joint'});
      for(const [a,c]of [[1,2],[2,3],[3,4],[1,5],[5,6],[6,7],[1,8],[8,9],[9,10],[1,11],[11,12],[12,13]])if(valid(b[a])&&valid(b[c])){const q=box([b[a],b[c]]),pad=len*.04;skeleton.push({left:q.left-pad,right:q.right+pad,top:q.top-pad,bottom:q.bottom+pad,part:'bone_corridor'});}
      trace.push(`${id} 躯干倾角 ${angle.toFixed(1)}°；${starts[rule.framing.start]}${rule.framing.startOffset?`(${rule.framing.startOffset>0?'+':''}${rule.framing.startOffset})`:''} → ${ends[rule.framing.end]}${rule.framing.endOffset?`(${rule.framing.endOffset>0?'+':''}${rule.framing.endOffset})`:''}；服装轮廓 ${clothesRows.length?'已参与':'未获得'}`);
    }
    if(all.length!==people.length)throw Error('部分人物缺少可靠肩胯参数，停止自动裁切，请改为单人或人工复核');
    if(!all.length)throw Error('没有可靠人物参数');
    if(avoidZones(rule).some(z=>z.enabled&&z.target==='head_contour')&&heads.length!==people.length)throw Error('部分人物缺少头部参考，无法确认头部强制避让');
    const area=rows.reduce((sum,[x,y,r,t])=>sum+Math.max(0,r-x)*t,0),centroid=area?{x:rows.reduce((sum,[x,y,r,t])=>sum+(x+r)/2*(r-x)*t,0)/area,y:rows.reduce((sum,[x,y,r,t])=>sum+(y+t/2)*(r-x)*t,0)/area}:null;
    trace.push(`轮廓采样占原图约 ${(Math.min(1,area/width/height)*100).toFixed(1)}%（多人重叠可能重复计入）`);
    const requiredHands=rule.protection.hands.startsWith('require'),one=rule.protection.hands.endsWith('one');
    const ids=people.map((p,i)=>p.person_id||'P'+(i+1));
    let handChoices=[[]];
    if(rule.protection.hands!=='none'){
      if(one)for(const id of ids){const options=hands.filter(h=>h.person_id===id);if(options.length)handChoices=handChoices.flatMap(c=>options.map(h=>[...c,h]));}
      else handChoices=[hands];
      for(const id of ids){const n=hands.filter(h=>h.person_id===id).length;if(requiredHands&&n<(one?1:2))throw Error('强制保护的手部未可靠观测，请改用尽量保护或人工复核');if(!requiredHands&&n<(one?1:2))warnings.push(`${id} 手部观测不足：只尽量保护已观测手部，不推算被遮挡的手`);}
    }
    const angle=Math.max(...angles),mode=!rule.balance.enabled?'紧凑':angle>=rule.balance.horizontal_degrees?'横卧':angle>=rule.balance.diagonal_degrees?'对角线':'直立';
    function run(parts,balanced,scale=1,expanding=false,budget=rule.max_extension_fraction){
      const margins=Object.fromEntries(['top','right','bottom','left'].map(s=>[s,{value:s==='bottom'&&rule.spacing.bottom_enabled===false?0:rule.spacing[s],unit:spacingUnit(rule,s),basis:'crop',relation:'min'}]));
      if(balanced&&mode==='横卧'&&spacingUnit(rule,'top')==='percent')margins.top.value=Math.max(margins.top.value,rule.balance.horizontal_top_percent);
      const f=mean(focuses);if(centroid){f.x=f.x*.7+centroid.x*.3;f.y=f.y*.7+centroid.y*.3;}if(balanced&&mode==='对角线'){const dx=people.reduce((n,p)=>{const b=A.points(p.pose_keypoints_2d);return n+(valid(b[8])&&valid(b[1])?b[8].x-b[1].x:0);},0);f.x+=Math.sign(dx)*width*rule.balance.diagonal_shift_percent/100;f.y+=height*rule.balance.diagonal_shift_percent/100;}
      const zones=avoidZones(rule).filter(z=>z.enabled),targets=zones.map(z=>({parts:z.target==='head_contour'?heads:z.target==='body_contour'&&bodyContour.length?bodyContour:skeleton,required:z.strength==='required',strength:z.strength}));
      const anatomy={bounds:A.union(parts),parts:[...parts,...(rule.framing.start==='head'?heads:[])],warnings:[...base.warnings,...warnings],person_ids:people.map(p=>p.person_id),mask_boxes:[],avoid_targets:targets};
      const result=A.plan({width,height,poses,parameters,aspect:rule.aspect,allowVirtual:rule.allow_virtual,requiredRegions:anatomy,preset:{engine:'manual-crop/v1',output:rule.output,margins,regions:{avoid:zones.map(z=>z.box)},composition:{movement_axis:rule.avoidance_motion||'free',avoidance_thresholds:true,avoidance_budget:budget,minimum_scale:scale,...(balanced&&mode!=='紧凑'&&!['waist_hip','shoulders'].includes(rule.framing.end)?{focus_source:f,focus_y_fraction:mode==='直立'?.32:.45}:{compact_anchor:'required_bottom'})}}});
      result.manual_avoid_checks=(result.directional_avoid_checks||A.avoidanceChecks(result.avoid_regions,targets)).map((check,i)=>({...check,source_index:avoidZones(rule).indexOf(zones[i]),name:zones[i].name||'避让 '+(i+1)}));
      result.manual_avoid_overlap=result.manual_avoid_checks.reduce((n,z)=>n+z.overlap,0);result.manual_growth_scale=scale;
      const unmet=result.manual_avoid_checks.some(z=>z.strength!=='preferred'&&!z.target_met);
      if(!expanding&&unmet&&(!rule.avoidance_motion||rule.avoidance_motion==='free')){
        const area=p=>(p.crop.right-p.crop.left)*(p.crop.bottom-p.crop.top),baseArea=area(result),limit=Math.min(rule.max_extension_fraction,result.canvas.missing_area_fraction+rule.protection.preference_extension_limit);
        const rank=p=>[Math.max(0,p.canvas.missing_area_fraction-limit),...A.avoidanceRank(p.manual_avoid_checks).slice(0,2),Math.max(0,area(p)/baseArea-1),p.canvas.missing_area_fraction];let best=result;
        for(const factor of [1.04,1.08,1.12,1.16,1.20,1.24])try{const p=run(parts,balanced,factor,true,limit);if(p.canvas.missing_area_fraction<=limit+1e-9&&A.compareRanks(rank(p),rank(best))<0)best=p;}catch{}
        if(best!==result)best.warnings.push(`为改善避让，在预算内将必要画布边长调整约${Math.round((best.manual_growth_scale-1)*100)}%`);return best;
      }
      return result;
    }
    const candidateRank=p=>rule.avoidance_motion&&rule.avoidance_motion!=='free'?p.manual_avoid_checks.map(z=>z.ignored?0:Math.max(0,z.overlap_ratio-z.allowed_overlap)):A.avoidanceRank(p.manual_avoid_checks);
    let answer=null;const failures=[];
    for(const choice of handChoices){const hard=[...all,...(requiredHands?choice:[])];let r;try{r=run(hard,false);}catch(e){failures.push(e.message);continue;}
      const softHands=!requiredHands?choice.filter(h=>!['waist_hip','shoulders'].includes(rule.framing.end)||desired.some(d=>d.person_id===h.person_id&&h.bottom<=d.bottom)):[];
      const candidates=[{parts:[...hard,...desired,...softHands],balanced:true},{parts:[...hard,...desired],balanced:false}];
      let accepted=false;for(const c of candidates){try{const p=run(c.parts,c.balanced);if(p.canvas.missing_area_fraction<=rule.max_extension_fraction&&p.canvas.missing_area_fraction<=r.canvas.missing_area_fraction+rule.protection.preference_extension_limit){r=p;accepted=true;break;}}catch(e){failures.push(e.message);}}
      if(!accepted)r.warnings.push('期望景别／构图偏好超出预算，已退回最低必保范围');
      r.protection_bounds=A.union(hard);const blocked=r.canvas.missing_area_fraction>rule.max_extension_fraction;
      r.blocked=blocked;r.trace=[...trace,`构图路由：${mode}`,`外补占成片 ${(r.canvas.missing_area_fraction*100).toFixed(1)}%`,accepted?'采用期望景别（含可满足的偏好）':'采用最低必保兜底'];
      r.warnings=[...new Set(r.warnings)];if(blocked)r.warnings.push('外扩上限未满足：仅显示候选，不可直接导出');
      r.preference_applied=accepted;r.extension_over_budget=r.canvas.missing_area_fraction>rule.max_extension_fraction;r.estimated_heads=estimatedHeads;r.estimated_points=estimated;r.review_required=r.review_required||estimated.length+estimatedHeads.length>0;if(estimated.length+estimatedHeads.length)r.trace.push(`使用 ${estimated.length+estimatedHeads.length} 个估计参照，需人工复核`);r.rule=rule;r.mode=mode;if(r.movement){const d=r.movement.source_delta;r.trace.push((r.movement.axis==='horizontal'?'仅横移':'仅纵移')+'：人物位移 '+(r.movement.axis==='horizontal'?d.x:d.y).toFixed(1)+' 原图px；画幅尺寸锁定');}for(const z of r.manual_avoid_checks){if(z.ignored){r.trace.push(z.name+'：与上方避让冲突，本次忽略');r.review_required=true;continue;}const label=z.required?'严格':z.strength==='moderate'?'适中':'宽松',text=`${z.name}：重叠 ${(z.overlap_ratio*100).toFixed(1)}% / 目标 ≤${Math.round(z.allowed_overlap*100)}%（${label}）`;r.trace.push(text);if(!z.target_met){r.review_required=true;r.warnings.push(text+'；已保留限制内的最佳候选，可导出并建议复核');}}
      const kept=hands.filter(h=>r.crop.left<=h.left&&r.crop.right>=h.right&&r.crop.top<=h.top&&r.crop.bottom>=h.bottom).length;r.trace.push(`观测到 ${hands.length} 只手，候选框内完整保留 ${kept} 只`);
      if(!requiredHands&&rule.protection.hands!=='none'&&kept<hands.length)r.warnings.push('部分观测手部未在候选框内；手部为偏好，没有扩大画布强行保留');
      if(!answer||Number(r.blocked)<Number(answer.blocked)||r.blocked===answer.blocked&&A.compareRanks(candidateRank(r),candidateRank(answer))<0)answer=r;
    }
    if(!answer)throw Error(failures[0]||'无法生成候选');return answer;
  }
  function solve(input){
    validate(input.rule);const requested=input.rule.framing.end,order=Object.keys(ends),position=order.indexOf(requested),auto=input.rule.estimation?.auto_downgrade!==false,attempts=[],candidates=[];
    const keys=auto?[requested,...order.slice(0,position).reverse()]:[requested];let error;
    for(const end of keys){try{const effective=structuredClone(input.rule);effective.framing.end=end;const r=solveCandidate({...input,rule:effective});attempts.push({end,status:r.blocked?'blocked':r.preference_applied?'framing':'core_only'});candidates.push(r);
        if(!r.blocked&&r.preference_applied){r.requested_framing=requested;r.effective_framing=end;r.fallback_attempts=attempts;if(end!==requested){r.review_required=true;r.trace.unshift(`自动退档：${ends[requested]} → ${ends[end]}（最低必保保持）`);r.warnings.push('原景别缺少可用参照或外扩超限，已采用更短景别，请确认实际构图');}return r;}
        if(r.blocked&&!r.extension_over_budget)return r;
      }catch(e){error=e;attempts.push({end,status:'unavailable',reason:e.message});if(!/(缺少|观测|估算|原图内|外扩|约束|顺序)/.test(e.message))throw e;}}
    const safe=candidates.find(r=>!r.blocked)||candidates[0];if(safe){safe.requested_framing=requested;safe.fallback_attempts=attempts;safe.trace.unshift('期望景别未满足，保留最低必保候选');safe.review_required=true;return safe;}throw error||Error('无可用景别，需要人工调整最低必保');
  }
  root.ManualCrop={defaults,validate,solve,ends,starts,avoidZones,spacingUnit};if(typeof module!=='undefined'&&module.exports)module.exports=root.ManualCrop;
})(typeof globalThis!=='undefined'?globalThis:this);
