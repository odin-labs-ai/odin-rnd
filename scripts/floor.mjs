// Authored orthographic geometry. This is a conceptual diagram, not a runtime map.
export function factoryFloor() {
  const p = (x, y, z = 0) => [(x - y) * .92 + 350, (x + y) * .43 + 86 - z];
  const pts = points => points.map(v => p(...v).map(n => n.toFixed(2)).join(',')).join(' ');
  const poly = (points, cls) => '<polygon class="' + cls + '" points="' + pts(points) + '"/>';
  const line = (a, b, cls = 'detail') => '<path class="' + cls + '" d="M' + p(...a).join(',') + 'L' + p(...b).join(',') + '"/>';
  const box = (x, y, z, w, d, h, cls = '') => '<g class="' + cls + '">' +
    poly([[x,y+d,z],[x+w,y+d,z],[x+w,y+d,z+h],[x,y+d,z+h]],'front') +
    poly([[x+w,y,z],[x+w,y+d,z],[x+w,y+d,z+h],[x+w,y,z+h]],'side') +
    poly([[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]],'top') + '</g>';
  const marker = (x,y,z,n) => {const [a,b]=p(x,y,z);return '<g class="station-marker"><circle cx="'+a+'" cy="'+b+'" r="12"/><text x="'+a+'" y="'+(b+.5)+'">'+n+'</text></g>'};
  const screenText = (x,y,text,cls='') => '<text class="'+cls+'" x="'+x+'" y="'+y+'">'+text+'</text>';
  let svg = '<svg class="factory-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 615" role="img" aria-labelledby="floor-title floor-description"><title id="floor-title">Odin software factory, conceptual assembly drawing</title><desc id="floor-description">An isometric factory connects a blueprint drafting table, robotic workcell, conformance gate and evidence records. Use the four station buttons below to explore each part.</desc>';
  svg += poly([[-12,-12,-8],[512,-12,-8],[512,392,-8],[-12,392,-8]], 'floor');
  for(let x=0;x<=500;x+=25) svg+=line([x,0,-7],[x,380,-7],'gridline');
  for(let y=0;y<=380;y+=25) svg+=line([0,y,-7],[500,y,-7],'gridline');
  svg += line([0,-32,-5],[500,-32,-5],'dimension')+line([-30,0,-5],[-30,380,-5],'dimension');
  for(const x of [0,500])svg+=line([x,-40,-5],[x,-20,-5],'dimension');
  for(const y of [0,380])svg+=line([-40,y,-5],[-20,y,-5],'dimension');
  svg += screenText(542,170,'INTENT → EVIDENCE')+screenText(85,250,'FLOOR 000');
  // Service rail behind the workcell and two electrical cabinets.
  svg += box(203,25,0,13,13,170,'machine')+box(393,25,0,13,13,170,'machine')+box(198,23,170,212,18,14,'machine');
  svg += line([210,44,160],[398,44,160],'detail')+box(327,18,153,35,28,21,'orange');
  svg += box(430,48,0,37,48,98,'machine')+box(469,48,0,22,48,98,'machine');
  for(let z=18;z<80;z+=10)svg+=line([431,97,z],[462,97,z]);
  svg += box(436,98,63,13,2,18,'orange');
  // Drafting station, engineered paper and rule marks.
  svg += '<g data-floor-station="blueprint" class="station-geometry active">';
  for(const [x,y] of [[25,50],[132,50],[25,127],[132,127]])svg+=box(x,y,0,7,7,57,'machine');
  svg += box(17,42,57,131,100,7,'machine');
  svg += poly([[30,54,65],[132,54,65],[132,129,65],[30,129,65]],'top');
  for(let x=40;x<128;x+=15)svg+=line([x,59,65],[x,122,65],'ghost');
  for(let y=65;y<124;y+=15)svg+=line([35,y,65],[126,y,65],'ghost');
  svg+=poly([[48,76,66],[92,76,66],[92,107,66],[48,107,66]],'detail');
  svg+=line([98,76,66],[120,76,66])+line([98,84,66],[120,84,66])+line([98,92,66],[112,92,66]);
  svg+=box(28,47,66,105,3,2,'orange')+box(150,50,0,28,38,78,'machine');
  svg+=line([150,89,49],[177,89,49])+line([150,89,23],[177,89,23]);
  svg+=marker(66,123,102,'01')+'</g>';
  // Central workcell, base, turntable and articulated tool arm.
  svg += '<g data-floor-station="workcell" class="station-geometry">';
  svg += box(226,102,0,126,98,8,'machine')+box(251,130,8,53,47,34,'machine');
  const arm=[[276,153,42],[267,158,109],[312,191,158],[332,234,119]];
  for(let i=0;i<arm.length-1;i++){
    const a=p(...arm[i]),b=p(...arm[i+1]);
    svg+='<path d="M'+a.join(',')+'L'+b.join(',')+'" stroke="#17231f" stroke-width="21" fill="none"/>';
    svg+='<path d="M'+a.join(',')+'L'+b.join(',')+'" stroke="#c07a4d" stroke-width="16" fill="none"/>';
    svg+='<path d="M'+(a[0]-4)+','+(a[1]-3)+'L'+(b[0]-4)+','+(b[1]-3)+'" stroke="#edab70" stroke-width="2" fill="none"/>';
  }
  for(const a of arm.slice(0,-1)){const [x,y]=p(...a);svg+='<circle cx="'+x+'" cy="'+y+'" r="11" fill="#263c30" stroke="#9db399"/><circle cx="'+x+'" cy="'+y+'" r="4" fill="#627e67"/>'}
  svg += line([332,234,119],[332,234,94],'detail heavy')+line([332,234,96],[324,234,90],'detail heavy')+line([332,234,96],[340,234,90],'detail heavy');
  svg+=line([242,171,9],[214,194,9],'conduit')+line([214,194,9],[171,194,9],'conduit')+line([171,194,9],[171,102,9],'conduit');
  svg+=marker(240,105,134,'02')+'</g>';
  // Conveyor: repeated rollers and driven legs.
  for(const x of [40,130,240,350,448])svg+=box(x,217,0,8,52,34,'machine');
  svg+=box(23,211,34,451,66,10,'belt');
  for(let x=27;x<471;x+=10)svg+=line([x,215,45],[x,273,45],'detail');
  svg+=box(20,207,43,457,5,5,'machine')+box(20,276,43,457,5,5,'machine');
  for(const x of [86,174,310,429])svg+=box(x,223,47,34,38,14,x===310?'orange':'machine');
  // Conformance gate: two posts and crossbeam over the conveyor.
  svg += '<g data-floor-station="gate" class="station-geometry">';
  svg+=box(365,194,0,19,17,119,'machine')+box(365,281,0,19,17,119,'machine')+box(359,190,119,31,113,18,'machine');
  svg+=poly([[366,212,119],[366,278,119],[366,278,49],[366,212,49]],'ghost');
  svg+=box(373,304,0,34,28,82,'machine')+box(377,333,52,23,2,19,'orange');
  svg+=line([375,280,50],[375,216,50],'conduit')+marker(373,277,156,'03')+'</g>';
  // Record trays and stacked output plates.
  svg += '<g data-floor-station="record" class="station-geometry">';
  svg+=box(447,302,0,47,64,20,'machine');
  for(let z=21;z<65;z+=8)svg+=box(443,302,z,55,62,4,'machine');
  svg+=line([451,350,66],[475,350,66])+line([451,343,66],[480,343,66])+line([451,336,66],[469,336,66]);
  svg+=marker(472,350,114,'04')+'</g>';
  // Floor markings carry wayfinding, never pretend telemetry.
  svg+=line([18,310,0],[375,310,0],'conduit')+line([375,310,0],[410,345,0],'conduit');
  for(let x=25;x<400;x+=18)svg+=line([x,324,0],[x+8,324,0],'dimension');
  svg+='<text class="floor-word" transform="matrix(.92 .43 -.92 .43 108 342)">ODIN / RESEARCH &amp; DEVELOPMENT</text>';
  svg+=screenText(45,550,'ORTHOGRAPHIC ASSEMBLY / CONCEPT DRAWING')+screenText(662,550,'DWG. OD-000 / A');
  svg+='<path class="dimension" d="M40 565H860M40 559v12M860 559v12"/>';
  svg+=screenText(43,589,'BLUEPRINT → WORKCELL → GATE → RECORD')+screenText(703,589,'NOT TO SCALE');
  return svg+'</svg>';
}
