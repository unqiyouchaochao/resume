/* 110kV 降压变电站 · 三维全景
 * 注册到 window.VIZ_SCENES.substation，渲染器 / 生命周期 / 拾取由 js/viz.js 负责。
 *
 * 布置口径（这一版按 AIS 屋外配电装置的真实关系重排，不再把设备排成一条「示意单线」）：
 *   x 轴 —— 间隔方向，进线、主变、母联各占一个间隔，沿 x 一字排开；
 *   z 轴 —— 进深方向，从远到近：进线门型架 → 避雷器 → 隔离开关 → CT → 断路器 → 双母线 → 主变间隔 → 主变 → 10kV 柜 → 出线。
 *   两条 110kV 母线沿 x 通长平行，分别落在 z=-18.4（I 段）与 z=-11.4（II 段）；
 *   每个间隔的母线侧隔离开关夹在两段母线之间，一台引线接 II 段，另一台跨越接 I 段 —— 这才是双母线该有的样子。
 *
 * 视线：默认全景（可 360° 环视 + 全站远近），巡游只是可选的一条导览路线。
 * 数据来源：A1 主接线图设备明细表 + 课程设计报告第 4/5/6 章（见 _交接-变电站-设备选型数据.md）
 */
(function () {
  if (!window.THREE) return;
  var SCENES = window.VIZ_SCENES = window.VIZ_SCENES || {};
  var THREE = window.THREE;

  /* ================= 设备数据 ================= */
  var DEV = {
    'qf-in': {
      name: '110kV 进线断路器', model: 'LW36-126/3150-40', qty: '2 台', volt: '110 kV',
      type: 'SF₆ 户外断路器',
      rated: [['额定电压', '126 kV'], ['额定电流', '3150 A'], ['额定开断电流', '40 kA'], ['峰值耐受', '100 kA'], ['热稳定', '4800 kA²·s']],
      duty: [['工作电流', '约 66 A'], ['短路水平', '110kV 侧约 3.1 kA']],
      why: '40 kA 是本站最高开断档，因为这条进线直接接系统电源，短路容量远大于发电厂那条。3150 A 额定不是为了正常负荷（只有约 66 A），而是两条进线互相转带时留的通流能力。'
    },
    'qf-bus': {
      name: '110kV 母联断路器', model: 'LW36-126/3150-31.5', qty: '1 台', volt: '110 kV',
      type: 'SF₆ 户外断路器',
      rated: [['额定电压', '126 kV'], ['额定电流', '3150 A'], ['额定开断电流', '31.5 kA'], ['峰值耐受', '80 kA'], ['热稳定', '2970 kA²·s']],
      duty: [['位置', '两段母线之间'], ['作用', '并列 / 解列运行']],
      why: '同一系列降一档到 31.5 kA：母联点的短路水平低于进线端，不需要 40 kA 那档。这叫按短路水平分档配置，避免全站一刀切选最贵的——这次设计里我自己觉得最像工程思维的一处取舍。'
    },
    'ds-in': {
      name: '110kV 隔离开关', model: 'GW4-126/3150-40', qty: '8 组', volt: '110 kV',
      type: '双柱水平旋转式（户外）',
      rated: [['额定电压', '126 kV'], ['额定电流', '3150 A'], ['峰值耐受', '100 kA'], ['4s 热稳定', '40 kA']],
      duty: [['作用', '检修时做可见断口'], ['联锁', '与断路器、接地开关互锁']],
      why: '没有灭弧能力，只做可见断口——检修时先断断路器再拉隔离开关，顺序反了会拉弧。额定电流与对应的断路器同档，保证串联回路不出现瓶颈。主变与母联间隔那几组取 31.5 kA 档，与各自断路器一致。'
    },
    'ct-110': {
      name: '110kV 电流互感器', model: 'LB-110W2', qty: '6 台', volt: '110 kV',
      type: '油浸式户外 CT',
      rated: [['变比', '400/5 A'], ['准确级', '0.2S / 0.5 / TPY / TPY'], ['额定电压', '126 kV']],
      duty: [['一次工作电流', '约 66 A'], ['二次', '5 A，进保护与测量']],
      why: '工作电流只有 66 A，选 75/5 这类贴边变比会让一次电流落在量程高端、测量精度反而下降，工程上留 4–6 倍裕度更稳，所以取 400/5。TPY 级绕组是给差动保护用的，短路暂态下不饱和——110 kV 侧必须配。'
    },
    'bus-110': {
      name: '110kV 母线', model: 'LGJ-400/35', qty: '双母线', volt: '110 kV',
      type: '钢芯铝绞线 · 户外软母线',
      rated: [['铝截面', '240 mm²'], ['总截面', '435 mm²'], ['载流量', '约 710 A']],
      duty: [['工作电流', '约 66 A'], ['布置', '户外构架，软母线']],
      why: '户外配电装置用软母线而非硬母线：跨度大、需要机械强度，钢芯承担拉力、铝股导电。载流量 710 A 对 66 A 是十倍余量——这里不是按载流量选的，是按机械强度与短路电动力选的，截面小了短路冲击下会甩动甚至断股。'
    },
    'mo-110': {
      name: '110kV 避雷器', model: 'HY10WZ-108/281', qty: '4 组', volt: '110 kV',
      type: '复合外套氧化锌避雷器',
      rated: [['额定电压', '108 kV'], ['标称放电电流残压', '281 kV'], ['结构', '无间隙 ZnO']],
      duty: [['安装位置', '架空进线端 + 母线']],
      why: '防的是沿线路侵入的雷电波，不是直击雷（直击雷靠避雷针）。108/281 要和被保护设备的绝缘水平配合：残压必须低于变压器雷电冲击耐受电压，否则等于没装。'
    },
    'es-110': {
      name: '110kV 接地开关', model: 'JN15-110', qty: '4 组', volt: '110 kV',
      type: '构架接地开关',
      rated: [['额定电压', '126 kV'], ['4s 热稳定', '与隔离开关同档']],
      duty: [['作用', '检修时把回路可靠接地']],
      why: '与隔离开关配套，检修时接地防感应电压或误送电伤人。接地开关与隔离开关之间必须机械闭锁：接地开关合上时隔离开关合不上，反之亦然。',
      note: '小体量贴挂件：点击能看参数，巡游镜头不在它上面停。'
    },
    'qf-tr': {
      name: '主变间隔断路器', model: 'LW36-126/3150-31.5', qty: '2 台', volt: '110 kV',
      type: 'SF₆ 户外断路器',
      rated: [['额定电压', '126 kV'], ['额定电流', '3150 A'], ['额定开断电流', '31.5 kA'], ['峰值耐受', '80 kA'], ['热稳定', '2970 kA²·s']],
      duty: [['位置', '主变高压侧'], ['负载', '单台主变 11.11 MVA']],
      why: '与母联同档 31.5 kA：主变支路比进线端的短路水平低——短路电流从系统经进线断路器过来时已被线路阻抗削弱。同一座站出现 40 kA 与 31.5 kA 两种开断档，不是采购凑巧，是按各点短路水平分别定档。',
      note: '型号取自 A1 图纸设备明细表，报告正文未单列这一项。'
    },
    'tr-main': {
      name: '主变压器', model: 'S11-M-12500/110', qty: '2 台', volt: '110 / 10.5 kV',
      type: '油浸式双绕组电力变压器',
      rated: [['容量', '12.5 MVA'], ['电压比', '110 / 10.5 kV'], ['调压', '±4×2.5%'], ['短路阻抗 Uk%', '10.5'], ['联结组', 'YNd11']],
      duty: [['单台带载', '全部剩余负荷 11.11 MVA'], ['运行方式', '两台分列运行']],
      why: '选两台而不是一台，是因为任一台故障或检修时另一台要能带起全部剩余负荷——11.11 MVA < 12.5 MVA 刚好够，这也是容量定在 12.5 MVA 的直接理由。Uk%=10.5：阻抗大则短路电流小、但电压波动大，10.5% 是这个容量等级的常规取值，兼顾限流与调压。YNd11：高压侧中性点直接接地，低压侧三角形接法滤三次谐波。'
    },
    'qf-10': {
      name: '10kV 断路器', model: 'ZW32-12/630-20', qty: '多台', volt: '10 kV',
      type: '户外柱上真空断路器',
      rated: [['额定电压', '12 kV'], ['额定电流', '630 A'], ['额定开断电流', '20 kA'], ['峰值耐受', '50 kA'], ['热稳定', '1600 kA²·s']],
      duty: [['工作电流', '611 A（剩余负荷）'], ['短路水平', 'Ik≈5 kA、ish≈12.75 kA']],
      why: '真空灭弧室免维护、适合频繁操作。20 kA 开断对 5 kA 有 4 倍余量、峰值 50 kA 对 12.75 kA 也有近 4 倍——余量大是因为 20 kA 这个档本身就这么配，不是刻意选大。',
      note: '发电厂直供那条路径工作电流 917 A，配的是 ZW32-12/1250-20；同站两个电流档是按实际负荷定档。'
    },
    'ds-10': {
      name: '10kV 隔离开关 / 分段开关', model: 'GW9-12/630-20', qty: '多台', volt: '10 kV',
      type: '户外单极式',
      rated: [['额定电压', '12 kV'], ['额定电流', '630 A'], ['峰值耐受', '50 kA']],
      duty: [['作用', '做可见断口'], ['配套', '与同路断路器同额定电流']],
      why: '10 kV 侧用 GW9 这种轻型结构，不像 110 kV 那样需要双柱旋转机构——电压等级降下来，机械结构也跟着简化，这是选型里最直观的经济性体现。'
    },
    'ct-10': {
      name: '10kV 电流互感器', model: 'LZZBJ9-12', qty: '多台', volt: '10 kV',
      type: '环氧浇注支柱式',
      rated: [['变比', '50/1 A（出线柜）'], ['绝缘', '环氧浇注'], ['额定电压', '12 kV']],
      duty: [['安装', 'KYN28A 柜内'], ['二次', '1 A 进保护装置']],
      why: '环氧浇注绝缘体积小、免油维护，装进 KYN28A 柜内正合适。二次侧取 1 A 而非 5 A：二次电流小、线路压降小，柜内到保护装置引线长时更有利。变比按各出线实际负荷分别选，不统一。'
    },
    'cab-10': {
      name: '10kV 开关柜', model: 'KYN28A-12', qty: '7 面', volt: '10 kV',
      type: '金属铠装移开式',
      rated: [['额定电压', '12 kV'], ['结构', '铠装 + 手车'], ['隔室', '母线 / 断路器 / 电缆 / 继电']],
      duty: [['布置', '户内，单列排列'], ['功能', '受电、馈线、分段、无功']],
      why: '移开式结构：断路器装在可抽出的手车上，检修时直接摇出、换上备用车，停电时间从小时级压到分钟级。铠装是把母线室、断路器室、电缆室、继电器室隔成独立小间，某一室燃弧不会窜到相邻室。',
      note: '继电保护装置 RCS-9611A 装在柜内继电器室，柜内不可见，本场景不做模型。'
    },
    'bus-10': {
      name: '10kV 母线', model: 'LMY-100×10', qty: '双段', volt: '10 kV',
      type: '矩形硬铝母线',
      rated: [['规格', '100×10 mm'], ['载流量', '> 1500 A'], ['热稳定最小截面', '约 4.6 mm²']],
      duty: [['工作电流', '611 A'], ['布置', '柜顶母线桥']],
      why: '户内开关柜用矩形硬母线：散热面积大、集肤效应比圆母线小，同样截面载流量更高。100×10 的 1500 A 对 611 A 是 2.5 倍，取这么大主因是动稳定——短路时相邻母排间的电动力与电流平方成正比，排间距一点、厚度不够就会变形。'
    },
    'mo-10': {
      name: '10kV 母线避雷器', model: 'Y5W-17/45', qty: '若干', volt: '10 kV',
      type: '氧化锌无间隙',
      rated: [['额定电压', '17 kV'], ['残压', '45 kV']],
      duty: [['安装', '10 kV 母线']],
      why: '保护 10 kV 侧设备免受侵入波与操作过电压。17/45 里的 17 是额定电压、45 是残压，残压要低于 10 kV 设备的雷电冲击耐受电压，否则保护失效。',
      note: '小体量贴挂件。'
    },
    'es-10': {
      name: '10kV 接地开关', model: 'JN15-10', qty: '若干', volt: '10 kV',
      type: '柜内接地开关',
      rated: [['额定电压', '12 kV'], ['操作', '与柜门 / 手车联锁']],
      duty: [['作用', '检修接地']],
      why: '与柜内隔离开关、断路器做五防闭锁：防止带接地开关合闸、防止带电合接地开关。这是开关柜「五防」里的两条，靠机械闭锁实现而不是靠程序。',
      note: '小体量贴挂件。'
    },
    'dxn': {
      name: '带电显示器', model: 'DXN-T', qty: '每间隔', volt: '10 kV',
      type: '感应式带电显示',
      rated: [['显示', '三相独立指示灯'], ['传感', '电容分压式']],
      duty: [['作用', '检修前确认母线是否带电']],
      why: '装在每个间隔，用传感器感应母线是否带电并亮灯。它是检修前的第一道确认：接地开关操作前先看它灭灯，再看验电器，两道确认才动手。',
      note: '小体量贴挂件。'
    },
    'cap': {
      name: '无功补偿装置', model: 'BWF10.5-120-1W', qty: '2 组', volt: '10 kV',
      type: '自愈式并联电容器',
      rated: [['单台容量', '120 kvar'], ['额定电压', '10.5 kV'], ['接法', '单相，组架安装']],
      duty: [['目标', '功率因数提到 0.9 以上'], ['作用', '降线损、释放主变容量']],
      why: '选电容器组而非 SVG：课程设计的负荷是稳态的，电容组够用且便宜；若负荷快速波动，才需要 SVG 那种连续可调的（报告改进建议里也提到这点）。',
      note: '稳态负荷的前提：现场若有谐波源，电容器组会与谐波谐振，得加滤波支路或改 SVG。'
    },
    'line-out': {
      name: '10kV 架空出线', model: 'LGJ-185/30', qty: '多回', volt: '10 kV',
      type: '钢芯铝绞线',
      rated: [['铝截面', '185 mm²'], ['对应容量', '约 1500–2000 kW / 回']],
      duty: [['选型口径', '每回按 1500–2000 kW 核算']],
      why: '导线截面同时受三个条件约束：载流量、电压损失、机械强度，取三者最大的那个。185 mm² 对应任务书给的单回容量区间。',
      note: '本场景只示 3 回，其余按 A1 图纸「同左」惯例省略；总回数以图纸为准。'
    },
    'relay': {
      name: '继电保护装置', model: 'RCS-941A / RCS-9611A', qty: '各若干', volt: '110 kV / 10 kV',
      type: '微机保护（柜内，不可见）',
      rated: [['110kV', 'RCS-941A'], ['10kV', 'RCS-9611A'], ['配置', '过流 + 电流速断'], ['灵敏系数', '5.9']],
      duty: [['作用', '近区速断、远区过流后备']],
      why: '配两套：过流保护带延时做后备、电流速断瞬时动作做近区主保护，速断靠定值躲过末端短路来保证选择性。灵敏系数 5.9 远大于规程要求的 1.5，故障时能可靠动作。',
      note: '柜内设备，本场景不建模型，参数折进 10kV 开关柜的说明里。'
    }
  };

  function descOf(d) {
    if (!d || !d.model) return '';
    var h = '<span class="dev-model">' + d.model + '</span>'
      + '<span class="dev-type">' + d.type + ' · ' + d.qty + ' · ' + d.volt + '</span>'
      + '<table class="dev-tab">';
    (d.rated || []).forEach(function (r) { h += '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; });
    (d.duty || []).forEach(function (r) { h += '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; });
    h += '</table><span class="dev-why">' + (d.why || '') + '</span>';
    return h;
  }

  function build(ctx) {
    var scene = ctx.scene, dark = ctx.dark;
    var C = {
      steel: dark ? 0x8d8577 : 0xbcb6a9,
      steel2: dark ? 0x6f6a5f : 0xa39d90,
      porc: dark ? 0xc4bdaf : 0xeee9de,
      warm: dark ? 0x9c8355 : 0xd8c9a4,
      tank: dark ? 0x5a625d : 0x8a938d,
      cab: dark ? 0x6f695d : 0xc6c0b3,
      panel: dark ? 0x322d26 : 0x6c665d,
      line: dark ? 0x8d8575 : 0x8f887a,
      ground: dark ? 0x211b12 : 0xe9e1cf,
      conc: dark ? 0x6b6559 : 0xcac4b6,
      cap: dark ? 0x7d8a8f : 0xa3b6bc
    };

    var matCache = {};
    function mat(color) {
      if (!matCache[color]) matCache[color] = new THREE.MeshStandardMaterial({ color: color, roughness: 0.74, metalness: 0.06 });
      return matCache[color];
    }
    function box(w, h, d, color, x, y, z) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
      m.position.set(x || 0, y === undefined ? h / 2 : y, z || 0);
      return m;
    }
    function cyl(r, h, color, x, y, z) {
      var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), mat(color));
      m.position.set(x || 0, y === undefined ? h / 2 : y, z || 0);
      return m;
    }
    /* 沿 x / 沿 z 的横置圆柱 */
    function hcyl(r, len, color, x, y, z) {
      var m = cyl(r, len, color, x, y, z);
      m.rotation.z = Math.PI / 2;
      return m;
    }
    function zcyl(r, len, color, x, y, z) {
      var m = cyl(r, len, color, x, y, z);
      m.rotation.x = Math.PI / 2;
      return m;
    }
    function cone(r1, r2, h, color, x, y, z) {
      var m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 10), mat(color));
      m.position.set(x || 0, y === undefined ? h / 2 : y, z || 0);
      return m;
    }
    /* 导线用透明材质：viz.js 的 stylize 只给不透明材质描边，
       细导线一旦被反向外壳包一圈就粗成铁管，这个判断绕开它。 */
    function wire(a, b, r, color) {
      var va = new THREE.Vector3(a[0], a[1], a[2]), vb = new THREE.Vector3(b[0], b[1], b[2]);
      var d = new THREE.Vector3().subVectors(vb, va);
      var len = d.length();
      if (len < 0.001) return null;
      var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6),
        new THREE.MeshStandardMaterial({ color: color, roughness: 0.66, metalness: 0.24, transparent: true, opacity: 0.94 }));
      m.position.copy(va).add(vb).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      return m;
    }
    function put(parent) {
      for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.add(arguments[i]);
      return parent;
    }

    /* ================= 设备模型 ================= */
    /* 断路器：三相分箱，三根支柱绝缘子 + 三段横置灭弧室（沿进深方向，导线从前后两端进出） */
    function mQF110() {
      var g = new THREE.Group();
      put(g, box(2.5, 0.3, 2.1, C.steel2, 0, 0.15),
        box(0.6, 0.9, 0.55, C.panel, 0, 1.22, 1.18));      /* 机构箱 */
      [-0.85, 0, 0.85].forEach(function (x) {
        put(g,
          cyl(0.13, 2.15, C.porc, x, 1.35),
          zcyl(0.2, 2.0, C.warm, x, 2.55),
          zcyl(0.1, 0.18, C.steel, x, 2.55, 1.05),
          zcyl(0.1, 0.18, C.steel, x, 2.55, -1.05),
          box(0.34, 0.12, 0.2, C.steel2, x, 2.86, 0.55));
      });
      return g;
    }
    /* 隔离开关：双柱水平旋转，两柱沿进深前后布置，导电臂在中线合上 */
    function mDS110() {
      var g = new THREE.Group();
      put(g, box(1.3, 0.26, 2.4, C.steel2, 0, 0.13));
      [-0.55, 0.55].forEach(function (z) {
        put(g, cyl(0.15, 1.95, C.porc, 0, 1.24, z));
        g.add(cyl(0.2, 0.06, C.porc, 0, 1.72, z));
        g.add(cyl(0.2, 0.06, C.porc, 0, 1.3, z));
      });
      put(g, zcyl(0.09, 1.2, C.line, 0, 2.22, 0),
        box(0.24, 0.12, 0.22, C.warm, 0, 2.31, -0.62),
        box(0.24, 0.12, 0.22, C.warm, 0, 2.31, 0.62),
        box(0.3, 0.6, 0.3, C.steel, 0.72, 0.48, 0));        /* 操作机构 */
      return g;
    }
    /* 电流互感器：油浸式单柱，顶部一次端子沿进深方向 */
    function mCT110() {
      var g = new THREE.Group();
      put(g, box(1.05, 0.24, 1.05, C.steel2, 0, 0.12),
        cone(0.19, 0.33, 2.3, C.porc, 0, 1.4),
        cyl(0.34, 0.4, C.steel, 0, 2.75),
        zcyl(0.09, 1.3, C.steel2, 0, 2.98),
        box(0.2, 0.26, 0.16, C.panel, 0, 1.9, 0.36));       /* 二次接线盒 */
      return g;
    }
    /* 避雷器：细柱 + 伞裙 + 顶部接线板（不要做成一座塔，比例要贴近复合外套的细长形） */
    function mMO() {
      var g = new THREE.Group();
      put(g, box(0.55, 0.24, 0.55, C.steel2, 0, 0.12),
        cyl(0.115, 2.55, C.steel, 0, 1.45));
      for (var i = 0; i < 10; i++) {
        g.add(cyl(0.185, 0.055, C.porc, 0, 0.42 + i * 0.21));
      }
      put(g, cyl(0.09, 0.16, C.warm, 0, 2.8), box(0.2, 0.06, 0.2, C.steel, 0, 2.9));
      return g;
    }
    /* 主变：基础 + 箱体 + 散热片 + 高低压套管 + 油枕 + 中性点套管 */
    function mTR() {
      var g = new THREE.Group();
      put(g, box(4.5, 0.36, 3.3, C.conc, 0, 0.18),
        box(3.3, 2.3, 2.2, C.tank, 0, 1.51));
      for (var j = 0; j < 6; j++) {
        g.add(box(0.08, 2.0, 1.55, C.steel, -1.72 - j * 0.14, 1.5, 0));
        g.add(box(0.08, 2.0, 1.55, C.steel, 1.72 + j * 0.14, 1.5, 0));
      }
      /* 高压侧（远，-z）三只套管 + 中性点套管 */
      [-0.62, 0, 0.62].forEach(function (x) {
        put(g, cone(0.17, 0.11, 1.0, C.porc, x, 3.16, -0.62),
          cyl(0.15, 0.1, C.warm, x, 3.72, -0.62));
      });
      /* 低压侧（近，+z）三只套管，短一些 */
      [-0.62, 0, 0.62].forEach(function (x) {
        put(g, cone(0.15, 0.1, 0.62, C.porc, x, 2.95, 0.62),
          cyl(0.14, 0.09, C.warm, x, 3.3, 0.62));
      });
      /* 油枕 + 支架 */
      put(g, hcyl(0.34, 1.7, C.warm, 0, 3.06, -1.05),
        box(0.09, 0.5, 0.09, C.steel2, -0.7, 3.2, -1.05),
        box(0.09, 0.5, 0.09, C.steel2, 0.7, 3.2, -1.05),
        box(0.34, 0.5, 0.3, C.panel, 1.5, 2.9, -0.5));       /* 端子箱 */
      return g;
    }
    /* 开关柜：柜体 + 前后门板 + 顶部母线室 + 仪表 */
    function mCAB() {
      var g = new THREE.Group();
      put(g, box(1.24, 0.14, 1.6, C.steel2, 0, 0.07),
        box(1.2, 2.2, 1.6, C.cab, 0, 1.24),
        box(1.06, 0.42, 0.04, C.panel, 0, 1.95, 0.81),
        box(1.06, 1.2, 0.04, C.panel, 0, 0.95, 0.81),
        box(0.03, 1.2, 0.02, C.steel2, 0, 0.95, 0.84),
        box(1.24, 0.1, 1.66, C.steel, 0, 2.36));
      var dial = cyl(0.07, 0.03, C.warm, 0, 2.0, 0.85);
      dial.rotation.x = Math.PI / 2;
      g.add(dial);
      return g;
    }
    /* 电容器组：框架 + 三只电容单元 + 放电线圈 */
    function mCAP() {
      var g = new THREE.Group();
      put(g, box(2.0, 0.22, 1.35, C.steel2, 0, 0.11));
      for (var i = -1; i <= 1; i++) g.add(cyl(0.29, 1.5, C.cap, i * 0.6, 1.0));
      put(g, box(1.9, 0.11, 0.11, C.steel, 0, 1.78, 0.58),
        box(1.9, 0.11, 0.11, C.steel, 0, 1.78, -0.58),
        box(0.11, 1.9, 0.11, C.steel, -0.94, 1.0, 0.58),
        box(0.11, 1.9, 0.11, C.steel, 0.94, 1.0, 0.58),
        box(0.11, 1.9, 0.11, C.steel, -0.94, 1.0, -0.58),
        box(0.11, 1.9, 0.11, C.steel, 0.94, 1.0, -0.58),
        box(0.3, 0.55, 0.28, C.panel, 1.2, 1.1, 0));
      return g;
    }
    /* 门型架（构架），带悬式绝缘子串 */
    function mFrame(h, span) {
      var g = new THREE.Group();
      put(g, cyl(0.13, h, C.steel2, -span / 2, h / 2),
        cyl(0.13, h, C.steel2, span / 2, h / 2),
        hcyl(0.11, span, C.steel2, 0, h - 0.12));
      for (var i = -1; i <= 1; i++) {
        var x = i * span * 0.28;
        g.add(cyl(0.17, 0.5, C.porc, x, h - 0.42));
        g.add(cyl(0.06, 0.5, C.steel2, x, h - 0.9));
      }
      return g;
    }
    /* 贴挂件：矮箱 + 操作杆 */
    function mSmall() {
      var g = new THREE.Group();
      put(g, box(0.36, 0.44, 0.36, C.steel, 0, 0.22),
        box(0.07, 0.52, 0.07, C.warm, 0.11, 0.52));
      return g;
    }
    /* 母线支柱：钢柱 + 支柱绝缘子（伞裙），顶到母线高度 */
    function mPost(h) {
      var g = new THREE.Group();
      var y0 = h * 0.52;
      put(g, box(0.7, 0.3, 0.7, C.conc, 0, 0.15),
        cyl(0.16, y0, C.steel2, 0, y0 / 2 + 0.3),
        cyl(0.2, h - y0 - 0.42, C.porc, 0, y0 + (h - y0 - 0.42) / 2 + 0.3));
      for (var i = 0; i < 4; i++) {
        g.add(cyl(0.3, 0.07, C.porc, 0, y0 + 0.34 + i * (h - y0 - 0.9) / 3));
      }
      g.add(cyl(0.13, 0.2, C.steel, 0, h - 0.1));
      return g;
    }

    /* ================= 注册 ================= */
    var parts = [];
    var segGroups = {};
    var labels = [];

    function reg(model, id, seg, opt) {
      opt = opt || {};
      var d = DEV[id] || {};
      var g = new THREE.Group();
      g.add(model);
      g.userData.part = id;
      g.userData.name = opt.name || d.name || id;
      g.userData.desc = descOf(d);
      g.userData.seg = seg;
      g.userData.wantLabel = opt.label !== false;
      /* 同一种设备在站里出现很多次，标签按间隔区分着写，否则一屏能叠出三个一样的型号 */
      g.userData.labelText = opt.labelText || (d.model ? d.model.split(' / ')[0].split(' · ')[0] : '');
      scene.add(g);
      parts.push(g);
      if (!segGroups[seg]) segGroups[seg] = [];
      segGroups[seg].push(g);
      return g;
    }

    /* ================= 几何基准 =================
     * x：间隔方向   z：进深   y：高度
     * 远端（-z）是 110kV 进线，近端（+z）是 10kV 出线，中间夹主变与开关柜。 */
    var Z = {
      gantry: -28.0,   /* 进线门型架 */
      mo: -26.0,       /* 避雷器 */
      dsLine: -24.2,   /* 线路侧隔离开关 */
      ct: -22.2,
      qf: -20.0,
      bus1: -18.4,     /* 110kV 母线 I 段（远） */
      dsBus: -15.0,    /* 母线侧隔离开关（夹在两段母线之间） */
      bus2: -11.4,     /* 110kV 母线 II 段（近） */
      trDs: -9.8,      /* 主变间隔隔离开关 */
      trQf: -7.6,
      trCt: -5.6,
      tr: -1.6,        /* 主变中心 */
      cab: 6.0,        /* 10kV 柜列 */
      cap: 9.4,        /* 无功补偿 */
      out: 14.0        /* 出线门型架 */
    };
    var yBus = 6.4;
    var xIn = 11.5;    /* 两条进线间隔中心 */
    var xTr = 5.0;     /* 两台主变间隔中心 */

    /* ---------- 地面 ----------
     * 大场景没有雾会糊成一片均匀灰：设备、地坪、背景全是相近的亮度，
     * 远近不分、主体不突出。雾把远处淡进背景色，近处设备立刻立起来。
     * 雾色取 stage 背景渐变的尾色（--bg-alt），淡出才没有接缝。 */
    scene.fog = new THREE.Fog(dark ? 0x1b1915 : 0xf4f1ea, 46, 140);
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(66, 56), mat(C.ground));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -7);
    scene.add(ground);
    /* 站区道路：比地坪深一档，把大块地坪切成几块，俯瞰时不再是一片平色 */
    var roadMat = mat(dark ? 0x2c2417 : 0xded4bc);
    [[66, 3.4, 0, 2.5], [3.4, 24, 14.8, 8]].forEach(function (r) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(r[0], r[1]), roadMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(r[2], 0.004, r[3]);
      scene.add(m);
    });

    /* ---------- 110kV 进线间隔（左右各一条） ---------- */
    [-1, 1].forEach(function (s, idx) {
      var x = s * xIn;

      var fr = reg(mFrame(8.0, 6.4), 'gantry', 1, { label: false, name: '110kV 进线门型架构架' });
      fr.position.set(x, 0, Z.gantry);
      fr.userData.desc = '<span class="dev-why">架空进线的终端构架：导线在这里从线路档距转入站内，经悬式绝缘子串挂下来，接避雷器与线路侧隔离开关。构架是站区里最高的钢结构，同时给进线、母线提供悬挂点。</span>';

      /* 架空进线 + 引下线（斜面到线路隔离开关顶部） */
      put(scene,
        wire([s * 24, 10.0, Z.gantry - 8], [x, 7.88, Z.gantry], 0.03, C.line),
        wire([x, 7.88, Z.gantry], [x, 2.22, Z.dsLine], 0.032, C.line));

      /* 避雷器：从引下线 T 接出去，落在间隔外侧 */
      var xMO = x + s * 3.0;
      var mo = reg(mMO(), 'mo-110', 1, { label: idx === 0, labelText: 'HY10WZ-108/281' });
      mo.position.set(xMO, 0, Z.mo);
      put(scene,
        wire([x, 5.05, Z.mo], [xMO, 5.05, Z.mo], 0.026, C.line),
        wire([xMO, 5.05, Z.mo], [xMO, 3.02, Z.mo], 0.026, C.line));

      var ds = reg(mDS110(), 'ds-in', 1, { label: idx === 0, labelText: 'GW4-126 · 线路侧' });
      ds.position.set(x, 0, Z.dsLine);

      var ct = reg(mCT110(), 'ct-110', 1, { label: idx === 0, labelText: 'LB-110W2' });
      ct.position.set(x, 0, Z.ct);

      var qf = reg(mQF110(), 'qf-in', 1, { label: idx === 0, labelText: 'LW36-126/3150-40' });
      qf.position.set(x, 0, Z.qf);

      /* 间隔内跳线：隔离开关 → CT → 断路器（软导线，带弧垂地拉直线） */
      put(scene,
        wire([x, 2.22, Z.dsLine + 0.6], [x, 2.98, Z.ct - 0.55], 0.036, C.line),
        wire([x, 2.98, Z.ct + 0.55], [x, 2.55, Z.qf - 1.05], 0.036, C.line),
        wire([x, 2.55, Z.qf + 1.05], [x, 3.5, Z.qf + 1.7], 0.036, C.line),
        wire([x, 3.5, Z.qf + 1.7], [x, 3.5, Z.dsBus + 1.0], 0.036, C.line));

      /* 母线侧隔离开关：一台接 II 段（近），一台跨越接 I 段（远） */
      var dsB2 = reg(mDS110(), 'ds-in', 2, { label: idx === 0, labelText: 'GW4-126 · 母线侧', name: '110kV 母线隔离开关（II 段）GW4-126/3150-40' });
      dsB2.position.set(x - s * 1.75, 0, Z.dsBus);
      var dsB1 = reg(mDS110(), 'ds-in', 2, { label: false, name: '110kV 母线隔离开关（I 段）GW4-126/3150-40' });
      dsB1.position.set(x + s * 1.75, 0, Z.dsBus);

      put(scene,
        /* 汇流 → 两台隔离开关的远端端子 */
        wire([x, 3.5, Z.dsBus - 0.55], [x - s * 1.75, 3.5, Z.dsBus - 0.55], 0.03, C.line),
        wire([x, 3.5, Z.dsBus - 0.55], [x + s * 1.75, 3.5, Z.dsBus - 0.55], 0.03, C.line),
        wire([x - s * 1.75, 3.5, Z.dsBus - 0.55], [x - s * 1.75, 2.31, Z.dsBus - 0.6], 0.03, C.line),
        wire([x + s * 1.75, 3.5, Z.dsBus - 0.55], [x + s * 1.75, 2.31, Z.dsBus - 0.6], 0.03, C.line),
        /* II 段：就近上母线 */
        wire([x - s * 1.75, 2.31, Z.dsBus + 0.6], [x - s * 1.75, yBus, Z.bus2], 0.034, C.line),
        /* I 段：抬高跨越 II 段母线，再落到 I 段 */
        wire([x + s * 1.75, 2.31, Z.dsBus + 0.6], [x + s * 1.75, yBus + 1.15, Z.dsBus + 0.6], 0.034, C.line),
        wire([x + s * 1.75, yBus + 1.15, Z.dsBus + 0.6], [x + s * 1.75, yBus + 1.15, Z.bus1], 0.034, C.line),
        wire([x + s * 1.75, yBus + 1.15, Z.bus1], [x + s * 1.75, yBus, Z.bus1], 0.034, C.line));

      /* 接地开关：挂在出线侧构架下 */
      var es = reg(mSmall(), 'es-110', 1, { label: false, name: '110kV 接地开关 JN15-110' });
      es.position.set(x + s * 1.0, 0, Z.dsLine + 1.6);
    });

    /* ---------- 110kV 双母线（沿 x 通长，两段平行） ---------- */
    function busBar(seg, z, x1, x2, label) {
      var g = new THREE.Group();
      for (var i = -1; i <= 1; i++) g.add(wire([x1, yBus + i * 0.16, z], [x2, yBus + i * 0.16, z], 0.055, C.line));
      /* 支柱避开各间隔中心（±11.5 / ±5 / 0），否则支柱正好立在设备背后，看着像穿模 */
      [-17.6, -8.2, 8.2, 17.6].forEach(function (x) {
        var post = mPost(yBus);
        post.position.set(x, 0, z);
        g.add(post);
      });
      var wrap = new THREE.Group();
      wrap.add(g);
      wrap.userData.part = 'bus-110';
      wrap.userData.name = '110kV 母线 LGJ-400/35 · ' + seg + ' 段';
      wrap.userData.desc = descOf(DEV['bus-110']);
      wrap.userData.seg = 2;
      wrap.userData.wantLabel = label;
      wrap.userData.labelText = 'LGJ-400/35 · ' + seg + ' 段';
      scene.add(wrap);
      parts.push(wrap);
      if (!segGroups[2]) segGroups[2] = [];
      segGroups[2].push(wrap);
      return wrap;
    }
    busBar('I', Z.bus1, -18.4, 18.4, true);
    busBar('II', Z.bus2, -18.4, 18.4, false);

    /* ---------- 母联间隔：跨接两段母线，设备落地 ---------- */
    (function () {
      var dsA = reg(mDS110(), 'ds-in', 2, { label: false, name: '母联间隔隔离开关（I 段）GW4-126/3150-31.5' });
      dsA.position.set(0, 0, Z.bus1 + 1.55);
      var qf = reg(mQF110(), 'qf-bus', 2, { label: true });
      qf.position.set(0, 0, Z.bus1 + 3.75);
      qf.scale.setScalar(0.92);
      var dsB = reg(mDS110(), 'ds-in', 2, { label: false, name: '母联间隔隔离开关（II 段）GW4-126/3150-31.5' });
      dsB.position.set(0, 0, Z.bus2 - 1.55);

      put(scene,
        wire([0, yBus, Z.bus1], [0, yBus, Z.bus1 + 0.95], 0.034, C.line),
        wire([0, yBus, Z.bus1 + 0.95], [0, 2.31, Z.bus1 + 0.95], 0.034, C.line),
        wire([0, 2.31, Z.bus1 + 2.15], [0, 2.55, Z.bus1 + 3.75 - 1.05], 0.034, C.line),
        wire([0, 2.55, Z.bus1 + 3.75 + 1.05], [0, 2.31, Z.bus2 - 2.15], 0.034, C.line),
        wire([0, 2.31, Z.bus2 - 0.95], [0, yBus, Z.bus2 - 0.95], 0.034, C.line),
        wire([0, yBus, Z.bus2 - 0.95], [0, yBus, Z.bus2], 0.034, C.line));
    })();

    /* ---------- 主变间隔 ---------- */
    [-1, 1].forEach(function (s, idx) {
      var x = s * xTr;

      var ds2 = reg(mDS110(), 'ds-in', 3, { label: false, name: '主变间隔隔离开关（II 段）GW4-126/3150-31.5' });
      ds2.position.set(x - s * 1.7, 0, Z.trDs);
      var ds1 = reg(mDS110(), 'ds-in', 3, { label: false, name: '主变间隔隔离开关（I 段）GW4-126/3150-31.5' });
      ds1.position.set(x + s * 1.7, 0, Z.trDs);

      put(scene,
        wire([x - s * 1.7, 2.31, Z.trDs + 0.6], [x - s * 1.7, yBus, Z.trDs + 0.6], 0.034, C.line),
        wire([x - s * 1.7, yBus, Z.trDs + 0.6], [x - s * 1.7, yBus, Z.bus2], 0.034, C.line),
        wire([x + s * 1.7, 2.31, Z.trDs + 0.6], [x + s * 1.7, yBus + 1.15, Z.trDs + 0.6], 0.034, C.line),
        wire([x + s * 1.7, yBus + 1.15, Z.trDs + 0.6], [x + s * 1.7, yBus + 1.15, Z.bus1], 0.034, C.line),
        wire([x + s * 1.7, yBus + 1.15, Z.bus1], [x + s * 1.7, yBus, Z.bus1], 0.034, C.line),
        /* 汇流 → 断路器 */
        wire([x, 3.45, Z.trDs - 0.55], [x - s * 1.7, 3.45, Z.trDs - 0.55], 0.03, C.line),
        wire([x, 3.45, Z.trDs - 0.55], [x + s * 1.7, 3.45, Z.trDs - 0.55], 0.03, C.line),
        wire([x, 3.45, Z.trDs - 0.55], [x, 2.55, Z.trQf + 1.05], 0.036, C.line));

      var qf2 = reg(mQF110(), 'qf-tr', 3, { label: idx === 0, labelText: 'LW36 · 主变间隔' });
      qf2.position.set(x, 0, Z.trQf);
      qf2.scale.setScalar(0.95);

      var ct2 = reg(mCT110(), 'ct-110', 3, { label: false, name: '主变高压侧电流互感器 LB-110W2' });
      ct2.position.set(x, 0, Z.trCt);

      put(scene,
        wire([x, 2.55, Z.trQf - 1.05], [x, 2.98, Z.trCt + 0.55], 0.036, C.line),
        wire([x, 2.98, Z.trCt - 0.55], [x, 3.72, Z.tr + 0.4], 0.036, C.line));

      var tr = reg(mTR(), 'tr-main', 3, { label: idx === 0, labelText: 'S11-M-12500/110' });
      tr.position.set(x, 0, Z.tr);

      /* 中性点套管接地引下线（YNd11 高压侧直接接地） */
      var esTr = reg(mSmall(), 'es-110', 3, { label: false, name: '主变中性点接地开关 JN15-110' });
      esTr.position.set(x + s * 2.4, 0, Z.tr - 0.9);
      put(scene, wire([x + s * 1.55, 2.6, Z.tr - 0.9], [x + s * 2.4, 1.0, Z.tr - 0.9], 0.022, C.line));
    });

    /* ---------- 主变低压侧 → 10kV 进线柜（母线桥） ----------
       从主变低压套管起，抬到 4.3 m 沿站侧走，再拐进柜顶。走线要绕开变压器本体，
       直接从箱体侧面斜穿过去会在镜头里看着像插进变压器。 */
    var cabX = [-5.4, -3.6, -1.8, 0, 1.8, 3.6, 5.4];
    [-1, 1].forEach(function (s) {
      var x = s * xTr, xd = s * 6.9;
      put(scene,
        wire([x, 3.3, Z.tr + 0.62], [x, 4.3, Z.tr + 0.62], 0.05, C.line),
        wire([x, 4.3, Z.tr + 0.62], [xd, 4.3, Z.tr + 0.62], 0.05, C.line),
        wire([xd, 4.3, Z.tr + 0.62], [xd, 4.3, 4.4], 0.05, C.line),
        wire([xd, 4.3, 4.4], [s * 5.4, 4.3, 4.4], 0.05, C.line),
        wire([s * 5.4, 4.3, 4.4], [s * 5.4, 2.52, Z.cab - 0.4], 0.05, C.line));
      /* 母线桥外壳：只画外壳，导线穿在里面；下面补两根支架，不然整条桥是悬空的 */
      put(scene,
        box(0.5, 0.46, 5.4, C.steel2, xd, 4.3, 1.7),
        box(1.9, 0.46, 0.5, C.steel2, (xd + s * 5.4) / 2, 4.3, 4.4),
        box(0.16, 4.05, 0.16, C.steel2, xd, 2.03, 0.6),
        box(0.16, 4.05, 0.16, C.steel2, xd, 2.03, 2.9),
        box(0.52, 0.16, 0.52, C.conc, xd, 0.08, 0.6),
        box(0.52, 0.16, 0.52, C.conc, xd, 0.08, 2.9));
      /* 点击代理：罩住外壳主段的透明盒（透明材质不会触发描边） */
      var bridge = reg(new THREE.Group(), 'bridge', 3, { label: false, name: '10kV 母线桥（外壳）' });
      var bhit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 6.2),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      bhit.position.set(xd, 4.3, 1.9);
      bridge.add(bhit);
      bridge.userData.desc = '<span class="dev-why">主变低压侧 10.5 kV 经母线桥送进 10 kV 配电室：桥内穿 LMY-100×10 硬铝母线，外壳可靠接地。对应主接线图上的主变低压侧进线回路。</span>';
    });

    /* ---------- 10kV 开关柜列（等距 7 面） ---------- */
    var CABS = [
      { i: 0, name: '10kV 进线柜 I（KYN28A-12）', seg: 4, label: true },
      { i: 1, name: '10kV 出线柜 1#（KYN28A-12）', seg: 5, label: false },
      { i: 2, name: '10kV 出线柜 2#（KYN28A-12）', seg: 5, label: false },
      { i: 3, name: '10kV 分段柜（KYN28A-12）', seg: 4, label: true },
      { i: 4, name: '10kV 出线柜 3#（KYN28A-12）', seg: 5, label: false },
      { i: 5, name: '无功补偿柜（KYN28A-12）', seg: 6, label: false },
      { i: 6, name: '10kV 进线柜 II（KYN28A-12）', seg: 4, label: false }
    ];
    CABS.forEach(function (c) {
      var cab = reg(mCAB(), 'cab-10', c.seg, { label: c.label, labelText: 'KYN28A-12', name: c.name });
      cab.position.set(cabX[c.i], 0, Z.cab);
    });

    /* ---------- 10kV 母线桥：柜顶两段，分段柜处断开 ---------- */
    [-1, 1].forEach(function (s, idx) {
      var b = new THREE.Group();
      var x1 = s < 0 ? cabX[0] - 0.62 : cabX[3] + 0.62;
      var x2 = s < 0 ? cabX[3] - 0.62 : cabX[6] + 0.62;
      b.add(box(Math.abs(x2 - x1), 0.3, 0.26, C.line, (x1 + x2) / 2, 2.62, Z.cab));
      var wrap = new THREE.Group();
      wrap.add(b);
      wrap.userData.part = 'bus-10';
      wrap.userData.name = '10kV 母线 LMY-100×10 · ' + (s < 0 ? 'I' : 'II') + ' 段';
      wrap.userData.desc = descOf(DEV['bus-10']);
      wrap.userData.seg = 4;
      wrap.userData.wantLabel = idx === 0;
      wrap.userData.labelText = 'LMY-100×10';
      scene.add(wrap);
      parts.push(wrap);
      if (!segGroups[4]) segGroups[4] = [];
      segGroups[4].push(wrap);
    });

    var seg10 = reg(mSmall(), 'ds-10', 4, { label: false, name: '10kV 分段开关 GW9-12/630-20' });
    seg10.position.set(-0.72, 2.78, Z.cab);
    seg10.scale.setScalar(0.75);

    var mo10 = reg(mMO(), 'mo-10', 4, { label: false });
    mo10.position.set(-6.4, 0, Z.cab - 0.1);
    mo10.scale.setScalar(0.5);

    var dxn = reg(mSmall(), 'dxn', 4, { label: false, name: '带电显示器 DXN-T' });
    dxn.position.set(cabX[0], 1.5, Z.cab + 0.9);
    dxn.scale.setScalar(0.62);

    /* ---------- 10kV 出线：一条构架集中挂 4 回（第 4 回按图纸「同左」省略） ----------
       早先是每回一座门型架，一排柱子像栅栏；实际 10 kV 出线走廊是共用构架、各回路挂串。 */
    var outX = [cabX[1], cabX[2], cabX[4]];
    var frOut = reg(mFrame(5.4, 9.4), 'gantry', 5, { label: false, name: '10kV 出线构架' });
    frOut.position.set(0.3, 0, Z.out);
    frOut.userData.desc = '<span class="dev-why">10 kV 出线的共用构架：各回路挂在同一排构架上，经耐张绝缘子串引出站外——实际出线走廊是一排共用构架，不是每回单独一座塔。</span>';
    outX.forEach(function (x) {
      put(scene,
        wire([x, 2.62, Z.cab], [x, 4.62, Z.out], 0.036, C.line),
        /* 耐张串 + 跳线，再往站外延伸一段（截断在画面边缘） */
        cyl(0.11, 0.5, C.porc, x, 4.4, Z.out + 0.06),
        cyl(0.14, 0.07, C.porc, x, 4.26, Z.out + 0.06),
        wire([x, 4.62, Z.out], [x, 4.62, Z.out + 2.2], 0.03, C.line),
        wire([x, 4.62, Z.out + 2.2], [x + 0.4, 4.25, Z.out + 5.6], 0.028, C.line));
    });
    var lineOut = reg(new THREE.Group(), 'line-out', 5, { label: true, labelText: 'LGJ-185/30', name: '10kV 架空出线 LGJ-185/30 · 1#–3#' });
    lineOut.position.set(0, 0, 0);
    /* 点击代理：贴在出线外侧的透明盒。
       必须用 transparent 材质 —— viz.js 的 stylize 只跳过透明件，否则会给这个大盒子
       套一层反向外壳描边，从俯视角度看进去就是一整块深色。 */
    var hit = new THREE.Mesh(new THREE.BoxGeometry(9.4, 5.6, 5.0),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.set(-0.9, 3.3, Z.out + 1.4);
    lineOut.add(hit);

    /* 第 4 回占位：构架上的那一串 + 一段断口 + 「同左 …」 */
    var sameLeft = reg(new THREE.Group(), 'line-out', 5, { label: false, name: '10kV 出线 · 同左 …（回数以 A1 图纸为准）' });
    sameLeft.position.set(0, 0, 0);
    sameLeft.userData.desc = '<span class="dev-why">A1 图纸上的重复间隔本来就是用「同左」两个字压缩的（设备明细表里出现 14 组），本场景沿用同一省略方式：出线只示 3 回，第 4 位留占位。总回数报告未给，以图纸为准。</span>';
    put(sameLeft,
      cyl(0.11, 0.5, C.porc, 4.2, 4.4, Z.out + 0.06),
      cyl(0.14, 0.07, C.porc, 4.2, 4.26, Z.out + 0.06),
      wire([4.2, 4.62, Z.out], [4.2, 4.62, Z.out + 1.2], 0.03, C.line));

    /* ---------- 无功补偿：2 组并联电容器 ----------
     * 信息卡写的是 qty「2 组」、解说也说「2 组」，模型就摆两组（每组三只单相单元，
     * BWF10.5-120-1W 是单相单元）。一组的话文字和模型对不上。 */
    var capGrp = new THREE.Group();
    var capA = mCAP(); capA.position.x = -1.35; capGrp.add(capA);
    var capB = mCAP(); capB.position.x = 1.35; capGrp.add(capB);
    var cap = reg(capGrp, 'cap', 6, { label: true });
    cap.position.set(9.6, 0, Z.cap);
    put(scene,
      wire([cabX[5], 2.62, Z.cab], [cabX[5], 3.3, Z.cab], 0.04, C.line),
      wire([cabX[5], 3.3, Z.cab], [cabX[5], 3.3, Z.cap], 0.04, C.line),
      wire([cabX[5], 3.3, Z.cap], [11.0, 3.3, Z.cap], 0.04, C.line),
      wire([8.25, 3.3, Z.cap], [8.25, 1.84, Z.cap], 0.04, C.line),
      wire([11.0, 3.3, Z.cap], [11.0, 1.84, Z.cap], 0.04, C.line));

    /* ================= 文字贴图 ================= */
    function textSprite(text, opt) {
      opt = opt || {};
      var dpr = 2, fs = opt.fs || 26, padX = 12, padY = 8;
      var cv = document.createElement('canvas');
      var c2 = cv.getContext('2d');
      var font = (opt.weight || '600') + ' ' + fs + 'px "JetBrains Mono","Consolas",monospace';
      c2.font = font;
      var tw = Math.ceil(c2.measureText(text).width);
      cv.width = (tw + padX * 2) * dpr;
      cv.height = (fs + padY * 2) * dpr;
      c2.scale(dpr, dpr);
      c2.font = font;
      if (opt.plain) {
        c2.fillStyle = dark ? 'rgba(242,238,230,.6)' : 'rgba(58,55,51,.55)';
        c2.textBaseline = 'middle';
        c2.fillText(text, padX, (fs + padY * 2) / 2);
      } else {
        var w = tw + padX * 2, h = fs + padY * 2, r = 7;
        c2.fillStyle = dark ? 'rgba(20,19,15,.9)' : 'rgba(255,255,255,.94)';
        c2.strokeStyle = dark ? 'rgba(201,168,106,.55)' : 'rgba(166,124,61,.45)';
        c2.lineWidth = 1.5;
        c2.beginPath();
        c2.moveTo(r, 0);
        c2.arcTo(w, 0, w, h, r);
        c2.arcTo(w, h, 0, h, r);
        c2.arcTo(0, h, 0, 0, r);
        c2.arcTo(0, 0, w, 0, r);
        c2.closePath();
        c2.fill();
        c2.stroke();
        c2.fillStyle = dark ? '#efe8da' : '#3a3733';
        c2.textBaseline = 'middle';
        c2.fillText(text, padX, h / 2);
      }
      var tex = new THREE.CanvasTexture(cv);
      tex.anisotropy = 2;
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, opacity: opt.opacity === undefined ? 1 : opt.opacity
      }));
      sp.userData.aspect = cv.width / cv.height;
      sp.scale.set(0.56 * sp.userData.aspect, 0.56, 1);
      return sp;
    }
    var sameLeftSp = textSprite('同左 …', { plain: true, fs: 24 });
    sameLeftSp.scale.multiplyScalar(1.25);
    sameLeftSp.position.set(4.2, 5.5, Z.out + 1.0);
    sameLeft.add(sameLeftSp);

    /* ================= 型号标签 ================= */
    parts.forEach(function (g) {
      if (!g.userData.wantLabel) return;
      var d = DEV[g.userData.part];
      if (!d) return;
      var model = g.userData.labelText || '';
      if (!model) return;
      if (model.length > 18) model = model.slice(0, 17) + '…';
      var sp = textSprite(model, { opacity: 0 });
      var bb = new THREE.Box3().setFromObject(g);
      sp.position.set(0, Math.max(1.1, bb.max.y - g.position.y + 1.0), 0);
      /* 型号牌永远画在设备之上：否则近距离时被绝缘子、构架挡掉半个字 */
      sp.material.depthTest = false;
      sp.renderOrder = 8;
      sp.userData.isLabel = true;
      sp.userData.seg = g.userData.seg;
      sp.userData.world = new THREE.Vector3();
      g.add(sp);
      labels.push(sp);
    });
    scene.updateMatrixWorld(true);
    labels.forEach(function (sp) { sp.getWorldPosition(sp.userData.world); });

    /* ================= 电流粒子 ================= */
    function glowTexture() {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      var c2 = cv.getContext('2d');
      var g2 = c2.createRadialGradient(32, 32, 0, 32, 32, 32);
      /* 浅色底用叠加混合会糊成一片白，所以按主题换两套：浅色走高饱和深金，深色走发光亮金 */
      if (dark) {
        g2.addColorStop(0, 'rgba(255,247,218,1)');
        g2.addColorStop(0.32, 'rgba(240,206,132,.95)');
        g2.addColorStop(0.7, 'rgba(201,168,106,.3)');
        g2.addColorStop(1, 'rgba(201,168,106,0)');
      } else {
        g2.addColorStop(0, 'rgba(120,74,8,1)');
        g2.addColorStop(0.34, 'rgba(158,105,22,.98)');
        g2.addColorStop(0.72, 'rgba(178,128,44,.42)');
        g2.addColorStop(1, 'rgba(196,150,70,0)');
      }
      c2.fillStyle = g2;
      c2.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    }
    var GLOW = glowTexture();

    function makePath(pts, n, size, phase) {
      var v = pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); });
      var seg = [], total = 0;
      for (var i = 1; i < v.length; i++) { var l = v[i].distanceTo(v[i - 1]); seg.push(l); total += l; }
      var pos = new Float32Array(n * 3);
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var pts2 = new THREE.Points(geo, new THREE.PointsMaterial({
        map: GLOW, size: size, transparent: true, depthWrite: false,
        blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
        /* 固定像素大小：按世界尺寸缩放时，全景距离下会缩成几个像素，肉眼找不到电流 */
        sizeAttenuation: false, opacity: dark ? 0.95 : 0.92
      }));
      /* 位置每帧才写进 buffer，包围球还是建几何体时的原点 → 会被视锥整个剔掉 */
      pts2.frustumCulled = false;
      scene.add(pts2);
      return { obj: pts2, v: v, seg: seg, total: total, n: n, pos: pos, phase: phase || 0 };
    }
    function samplePath(p, t) {
      var d = t * p.total, i = 0;
      while (i < p.seg.length - 1 && d > p.seg[i]) { d -= p.seg[i]; i++; }
      var a = p.v[i], b = p.v[i + 1];
      var u = p.seg[i] ? Math.min(1, d / p.seg[i]) : 0;
      return [a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u];
    }

    var PATHS = [];
    /* 主链一：左进线 → 母线 I → 主变 1 → 10kV 进线柜 I → 出线 1# */
    PATHS.push(makePath([
      [-24, 10.0, Z.gantry - 8], [-xIn, 7.88, Z.gantry], [-xIn, 2.22, Z.dsLine],
      [-xIn, 2.98, Z.ct], [-xIn, 2.55, Z.qf], [-xIn, 3.5, Z.dsBus],
      [-xIn - 1.75, 3.5, Z.dsBus], [-xIn - 1.75, yBus, Z.bus2],
      [-xIn - 1.75, yBus, Z.bus1], [-xTr - 1.7, yBus, Z.bus1],
      [-xTr - 1.7, yBus, Z.trDs + 0.6], [-xTr - 1.7, 2.31, Z.trDs],
      [-xTr, 3.45, Z.trDs], [-xTr, 2.55, Z.trQf], [-xTr, 2.98, Z.trCt],
      [-xTr, 3.72, Z.tr], [-xTr, 3.3, Z.tr + 0.62], [-xTr, 3.85, Z.tr + 0.9],
      [-5.4, 3.85, 3.6], [-5.4, 2.52, Z.cab],
      [-5.4, 2.62, Z.cab], [-3.6, 2.62, Z.cab], [-3.6, 4.9, Z.out], [-3.5, 3.9, Z.out + 2.6]
    ], 78, dark ? 7.5 : 7.0, 0));
    /* 主链二：右进线 → 母线 II → 主变 2 → 10kV 进线柜 II → 出线 3# */
    PATHS.push(makePath([
      [24, 10.0, Z.gantry - 8], [xIn, 7.88, Z.gantry], [xIn, 2.22, Z.dsLine],
      [xIn, 2.98, Z.ct], [xIn, 2.55, Z.qf], [xIn, 3.5, Z.dsBus],
      [xIn - 1.75, 3.5, Z.dsBus], [xIn - 1.75, yBus, Z.bus2],
      [xTr - 1.7, yBus, Z.bus2], [xTr - 1.7, yBus, Z.trDs + 0.6],
      [xTr - 1.7, 2.31, Z.trDs], [xTr, 3.45, Z.trDs], [xTr, 2.55, Z.trQf],
      [xTr, 2.98, Z.trCt], [xTr, 3.72, Z.tr], [xTr, 3.3, Z.tr + 0.62],
      [xTr, 3.85, Z.tr + 0.9], [5.4, 3.85, 3.6], [5.4, 2.52, Z.cab],
      [5.4, 2.62, Z.cab], [1.8, 2.62, Z.cab], [1.8, 4.9, Z.out], [1.9, 3.9, Z.out + 2.6]
    ], 78, dark ? 7.5 : 7.0, 0));
    /* 母联：I 段 ↔ II 段 */
    PATHS.push(makePath([
      [0, yBus, Z.bus1], [0, 2.31, Z.bus1 + 1.55], [0, 2.55, Z.bus1 + 3.75],
      [0, 2.31, Z.bus2 - 1.55], [0, yBus, Z.bus2]
    ], 14, dark ? 6.5 : 6.0, 0.5));
    /* 旁支：10kV II 段母线 → 无功补偿 */
    PATHS.push(makePath([
      [3.6, 2.62, Z.cab], [3.6, 3.3, Z.cab], [3.6, 3.3, Z.cap], [8.25, 3.3, Z.cap], [8.25, 1.84, Z.cap]
    ], 10, dark ? 5.5 : 5.0, 0.25));

    /* ================= 相机巡游（可选导览） =================
     * 默认不进巡游：全景由 viz.js 的轨道控制器负责，巡游只是「按电流走一遍」的导览。 */
    /* 机位约定（改机位前先看这条，踩过两次坑）：
     *   ① 母线支柱立在 x=±17.6 / ±8.2、z=Z.bus1 与 Z.bus2 上，8 m 高的细杆。
     *      视线的 xz 连线一旦从柱子附近穿过，画面上就是一整根绝缘子糊在正中间，
     *      所以在站区外绕行、让视线落在两条母线「之间」或「外侧」，不要横穿母线行。
     *   ② 每段至少留 12 m 距离：设备是 5–8 m 高的，挨太近会被画面切掉。
     *   ③ 段与段之间的插值路径也要顺带满足 ①，否则中间过渡帧同样会撞柱子。 */
    var KEYS0 = [
      { p: [22, 34, 36], t: [0, 3, -2], d: 3.6, seg: 0, name: '全站俯瞰' },
      { p: [-32, 11, -27], t: [-11.5, 3.6, -22], d: 3.6, seg: 1, name: '110kV 进线' },
      /* 这一段是进线间隔的中景：方向和「110kV 进线」一致、只是推近，
       * 从站外侧斜看过去，视线不会横穿母线行（横穿必撞 8 m 支柱，整根糊在画面正中）。 */
      { p: [-26, 8.5, -24.5], t: [-11.5, 3.0, -21], d: 3.2, seg: 1, name: '进线间隔设备' },
      /* 斜看母线走径：两条母线在画面里呈一对收拢的平行线，比正对着看更容易读出「两条」。 */
      { p: [13, 12, -4], t: [-1, 4.6, -16], d: 3.4, seg: 2, name: '双母线 + 母联' },
      { p: [-19, 10, 13], t: [-5, 2.6, -2], d: 3.4, seg: 3, name: '主变' },
      { p: [-16, 7, 18], t: [-1.5, 1.5, 6], d: 3.0, seg: 4, name: '10kV 开关柜' },
      { p: [-15, 12, 25], t: [-1, 3.4, 13], d: 3.2, seg: 5, name: '10kV 出线' },
      { p: [14, 4.4, 15.5], t: [9.6, 1.4, 9.4], d: 2.8, seg: 6, name: '无功补偿' },
      { p: [22, 34, 36], t: [0, 3, -2], d: 0, seg: 0, name: '回到全站' }
    ];
    /* 路线二：双母线倒母线的操作顺序（原理演示——课设只做到图纸与计算，没有操作票）。
     * 机位约定同上：正对设备的视线取「x 恒定」的纯 z 向观察，天然不穿任何母线支柱；
     * 跨区过渡帧抬到 14 m 高空，从 6.4 m 支柱顶上方掠过。 */
    var KEYS1 = [
      { p: [22, 34, 36], t: [0, 3, -2], d: 4.2, seg: 0, name: '倒母线演示',
        n: '倒闸操作演示：这是双母线倒母线的标准顺序，属于原理演示——课设只做到图纸与计算，没有操作票。' },
      { p: [-26, 8.5, -24.5], t: [-11.5, 3.0, -21], d: 3.4, seg: 1, name: '确认断路器分闸',
        n: '第 0 步：确认进线断路器在分闸位置。隔离开关没有灭弧能力，严禁带负荷拉合。' },
      { p: [-12.6, 5.5, -11.6], t: [-9.75, 2.4, -15.3], d: 3.8, seg: 2, name: '第 1 步 · 合 II 段刀闸',
        n: '第 1 步：合上 II 段母线侧隔离开关。倒母线的口诀是「先合后断」——新母线侧先合上，才能去动原来那一侧。' },
      { p: [11, 7, -1], t: [0, 2.8, -14.9], d: 3.8, seg: 2, name: '第 2 步 · 合母联',
        n: '第 2 步：合上母联断路器，两段母线并列运行；核对两段负荷分配正常后再动刀闸。' },
      { p: [-4, 14, -18], t: [-9.75, 2.4, -15.3], d: 3.4, seg: 2, name: '第 3 步 · 拉 I 段刀闸',
        n: '第 3 步：拉开 I 段母线侧隔离开关，回路已经全部转到 II 段。' },
      { p: [-12.2, 5.2, -12.0], t: [-9.75, 2.4, -15.3], d: 3.6, seg: 2, name: '收尾 · 断母联',
        n: '收尾：断开母联断路器，回到分列运行，倒母线完成。' },
      { p: [22, 34, 36], t: [0, 3, -2], d: 0, seg: 0, name: '回到全站' }
    ];
    /* 路线三：主变停电 / 送电顺序（原理演示）。停电从负荷侧往电源侧，送电相反。 */
    var KEYS2 = [
      { p: [22, 34, 36], t: [0, 3, -2], d: 3.8, seg: 0, name: '主变停送电',
        n: '主变停电 / 送电顺序演示：停电从负荷侧往电源侧，送电相反。同样是原理演示。' },
      { p: [-19, 10, 13], t: [-5, 2.6, -2], d: 3.4, seg: 3, name: '主变间隔',
        n: '主变间隔全景：从主变往外要依次经过 110 kV 断路器、隔离开关三级断口，10 kV 侧还有一级。' },
      { p: [-16, 7, 18], t: [-1.5, 1.5, 6], d: 3.2, seg: 4, name: '第 1 步 · 断 10kV',
        n: '第 1 步（停电）：断开 10 kV 进线柜断路器，主变先卸掉全部负荷。' },
      { p: [-13, 6, 0], t: [-5, 2.8, -7.6], d: 3.2, seg: 3, name: '第 2 步 · 断 110kV',
        n: '第 2 步：断开 110 kV 主变间隔断路器，变压器转入空载。' },
      { p: [-6.7, 8, -13.5], t: [-6.7, 2.3, -9.8], d: 3.4, seg: 3, name: '第 3 步 · 拉刀闸',
        n: '第 3 步：拉开两侧隔离开关做可见断口；转检修时再合上中性点接地开关。' },
      { p: [22, 34, 36], t: [0, 3, -2], d: 0, seg: 0, name: '回到全站',
        n: '送电按相反顺序：合隔离开关 → 合 110 kV 断路器 → 合 10 kV 断路器带负荷。' }
    ];
    var TOURS = [KEYS0, KEYS1, KEYS2].map(function (keys) {
      var cycle = 0;
      keys.forEach(function (k) { k.at = cycle; cycle += k.d; });
      return { keys: keys, cycle: cycle };
    });
    var TOUR_NAMES = ['沿电流巡游', '倒闸操作演示', '主变停送电'];

    var run = { cur: 0, t: 0, playing: false, seg: 0, held: false };
    function curTour() { return TOURS[run.cur]; }
    function curCycle() { return TOURS[run.cur].cycle; }
    var lastSeg = -1;
    var _v = new THREE.Vector3();
    function smooth(u) { return u * u * (3 - 2 * u); }

    function camAt(time) {
      var keys = curTour().keys;
      var tt = time % curCycle();
      var i = 0;
      while (i < keys.length - 2 && tt >= keys[i].at + keys[i].d) i++;
      var a = keys[i], b = keys[i + 1];
      var u = a.d ? Math.max(0, Math.min(1, (tt - a.at) / a.d)) : 1;
      var s = smooth(u);
      return {
        p: [a.p[0] + (b.p[0] - a.p[0]) * s, a.p[1] + (b.p[1] - a.p[1]) * s, a.p[2] + (b.p[2] - a.p[2]) * s],
        t: [a.t[0] + (b.t[0] - a.t[0]) * s, a.t[1] + (b.t[1] - a.t[1]) * s, a.t[2] + (b.t[2] - a.t[2]) * s],
        seg: s > 0.5 ? b.seg : a.seg,
        name: s > 0.5 ? b.name : a.name,
        n: s > 0.5 ? b.n : a.n
      };
    }

    var elFill = ctx.stage.querySelector('.run-fill');
    var elStage = ctx.stage.querySelector('.run-stage');
    var bar = ctx.stage.querySelector('.viz-runbar');
    function syncBar() {
      if (!bar) return;
      bar.hidden = !run.playing;
    }
    syncBar();

    var tourBtns = [];
    function syncBtns() {
      tourBtns.forEach(function (b, i) {
        /* 只有真的在播（或暂停在这一帧）的路线才描金；播完自动停下后按钮回到常态，不留「还亮着」的错觉 */
        var live = (run.playing || run.held) && i === run.cur;
        b.classList.toggle('is-on', live);
        b.textContent = (live && run.playing) ? '暂停播放' : (live ? '继续播放' : TOUR_NAMES[i]);
      });
    }
    /* 用户一动镜头就交出控制权：把当前巡游机位换算成轨道参数，避免视角跳变 */
    function onGrab() {
      if (!run.playing && !run.held) return;
      var c = camAt(run.t);
      run.playing = false;
      run.held = false;
      syncBar();
      syncBtns();
      if (ctx.adopt) ctx.adopt(c.t);
    }
    ctx.stage.addEventListener('pointerdown', onGrab);
    ctx.stage.addEventListener('wheel', onGrab, { passive: true });

    /* ================= 每帧 ================= */
    var segNames = ['全站', '110kV 进线', '110kV 双母线', '主变', '10kV 开关柜', '10kV 出线', '无功补偿'];
    var SEG_NARR = [
      '全站：两条 110 kV 进线各带一段母线，母联合上时并列运行、断开时分列，两台主变各供一段 10 kV。',
      '进线：架空线经门型架下来，先过避雷器与线路侧隔离开关，再经 CT、断路器，到母线侧隔离开关分接两段母线。',
      '双母线：两段母线沿站区通长平行；每台母线隔离开关各接一段，一台跨越另一段引上——这就是「双母线带母联」的接线本质。',
      '主变：110 kV 经主变间隔的断路器与 CT 接到 2×12.5 MVA 主变，低压侧 10.5 kV 经母线桥送进开关柜。',
      '10 kV：7 面 KYN28A 单列布置，两段母线在分段柜处断开；进线、出线、分段、无功各占一面。',
      '出线：3 回架空出线从出线柜经门型架送出，第 4 位按 A1 图纸「同左」惯例省略。',
      '无功补偿：2 组并联电容器接在 10 kV II 段，把功率因数提到 0.9 以上。'
    ];

    /* 播完一整遍就停：末帧本来就是「回到全站」，停住时不跳画面。
     * 停的瞬间必须把位姿交给轨道控制器（ctx.adopt）——巡游期间是我们每帧直接写相机，
     * 一旦不再写，viz.js 的 applyCamera 会把它拉回自己的 theta/phi/radius，看着像被踹了一脚。 */
    function finishTour() {
      run.t = 0;
      run.playing = false;
      run.held = false;
      var c0 = camAt(0);
      run.seg = c0.seg;
      ctx.camera.position.set(c0.p[0], c0.p[1], c0.p[2]);
      ctx.camera.lookAt(c0.t[0], c0.t[1], c0.t[2]);
      if (ctx.adopt) ctx.adopt(c0.t);
      syncBar();
      syncBtns();
    }

    function update(dt) {
      if (run.playing) {
        run.t += dt;
        if (run.t >= curCycle()) finishTour();
      }
      /* held 也要每帧写机位：viz.js 的轨道控制器每帧都会把相机拉回自己的 theta/phi/radius，
       * 只写一次会被它顶掉（踩过：setTour 之后画面弹回全景）。 */
      if (run.playing || run.held) {
        var c = camAt(run.t);
        run.seg = c.seg;
        ctx.camera.position.set(c.p[0], c.p[1], c.p[2]);
        ctx.camera.lookAt(c.t[0], c.t[1], c.t[2]);
      }

      /* 电流粒子：只要场景在跑就流动（全景下也让人看出哪条是带电通路） */
      for (var pi = 0; pi < PATHS.length; pi++) {
        var p = PATHS[pi];
        p.phase = (p.phase + dt * (pi === 2 ? 0.075 : 0.05)) % 1;
        for (var i = 0; i < p.n; i++) {
          var q = samplePath(p, (p.phase + i / p.n) % 1);
          p.pos[i * 3] = q[0]; p.pos[i * 3 + 1] = q[1]; p.pos[i * 3 + 2] = q[2];
        }
        p.obj.geometry.attributes.position.needsUpdate = true;
      }

      /* 标签：巡游时只显示当前这段，全景时按距离给；
         再把投影到屏幕上互相压住的后者让掉——不这么做，一屏十几个型号会糊成一团。 */
      var cam = ctx.camera, camPos = cam.position;
      var stageW = ctx.stage.clientWidth || 600, stageH = ctx.stage.clientHeight || 420;
      var vh = 2 * Math.tan(cam.fov * Math.PI / 360);
      var cand = [], kept = [];
      for (var li = 0; li < labels.length; li++) {
        var sp = labels[li];
        var d = sp.userData.world.distanceTo(camPos);
        var on = run.playing ? (sp.userData.seg === run.seg) : true;
        var hgt = Math.max(0.24, Math.min(2.6, d * 0.032));
        sp.scale.set(hgt * (sp.userData.aspect || 4), hgt, 1);

        var v = _v.copy(sp.userData.world).project(cam);
        var hpx = hgt / (Math.max(d, 0.01) * vh) * stageH;
        cand.push({
          sp: sp, d: d, on: on,
          x: (v.x * 0.5 + 0.5) * stageW,
          y: (-v.y * 0.5 + 0.5) * stageH,
          w: hpx * (sp.userData.aspect || 4),
          h: hpx,
          back: v.z > 1
        });
      }
      cand.sort(function (a, b) { return a.d - b.d; });
      for (var ci = 0; ci < cand.length; ci++) {
        var c = cand[ci];
        var o = (!c.on || c.back) ? 0 : c.d < 30 ? 1 : c.d < 46 ? (46 - c.d) / 16 : 0;
        if (o > 0) {
          var r = { x: c.x - c.w / 2 - 3, y: c.y - c.h / 2 - 2, w: c.w + 6, h: c.h + 4 };
          for (var ki = 0; ki < kept.length; ki++) {
            var q = kept[ki];
            if (r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y) { o = 0; break; }
          }
          if (o > 0) kept.push(r);
        }
        /* 材质写会触发 uniform 更新，别每帧无条件写；淡出过程中变化超过 1.5% 才落一次 */
        var op = o * 0.96;
        if (Math.abs((c.sp.material.opacity || 0) - op) > 0.015) c.sp.material.opacity = op;
        var vis = o > 0.04;
        if (c.sp.visible !== vis) c.sp.visible = vis;
      }

      /* 当前巡游段的设备微微提亮：只在换段时写一次材质 */
      if (run.seg !== lastSeg) {
        lastSeg = run.seg;
        for (var s in segGroups) {
          var isOn = (+s === run.seg);
          segGroups[s].forEach(function (g) {
            g.traverse(function (o) {
              if (!o.isMesh || o.userData.isOutline || !o.material || !o.material.emissive) return;
              if (o.material.userData.baseEm === undefined) o.material.userData.baseEm = o.material.emissive.getHex();
              o.material.emissive.setHex(isOn ? 0x2a2010 : o.material.userData.baseEm);
            });
          });
        }
      }

      if (elFill && run.playing) {
        elFill.style.width = ((run.t % curCycle()) / curCycle() * 100).toFixed(1) + '%';
        if (elStage) elStage.textContent = segNames[run.seg] || '';
      }
    }

    /* hud / 解说：巡游中和「停在导览某一帧」都按该段报，其余报全景那一套 */
    function hud() {
      var live = run.playing || run.held;
      var c = camAt(run.t);
      return [
        { label: '视角', value: run.playing ? '巡游中' : (run.held ? '已暂停' : '全景') },
        { label: '位置', value: live ? (c.name || segNames[run.seg]) : '全站' },
        { label: '电压侧', value: live && run.seg >= 4 ? '10 kV' : live ? '110 kV' : '110 / 10 kV' }
      ];
    }

    function narr() {
      if (!(run.playing || run.held)) return SEG_NARR[0];
      var c = camAt(run.t);
      return c.n || SEG_NARR[run.seg] || SEG_NARR[0];
    }

    function extraButtons(host) {
      function mk(label, fn) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sm';
        b.textContent = label;
        b.addEventListener('click', fn);
        host.appendChild(b);
        return b;
      }
      tourBtns = TOUR_NAMES.map(function (name, i) {
        return mk(name, function () {
          if (run.cur === i && (run.playing || run.held)) {
            if (run.playing) {
              /* 暂停：停在当前这一帧。只把 playing 置 false 的话，下一帧起没人写相机，
                 viz.js 的 applyCamera 会按默认轨道参数把镜头拉回全景（看着像被倒回去）。 */
              run.playing = false;
              run.held = true;
              var c = camAt(run.t);
              if (ctx.adopt) ctx.adopt(c.t);
            } else {
              run.held = false;
              run.playing = true;      /* 从暂停处继续 */
            }
          } else {
            run.cur = i;
            run.t = 0;                 /* 换路线 / 重新播放：从头开始 */
            run.held = false;
            run.playing = true;
          }
          syncBar();
          syncBtns();
        });
      });
      /* 「回到全景」由画面右上角那颗按钮统一负责，这里不再重复放一个 */
    }

    /* ================= 合批：零件烘成顶点色 =================
     * 整站建出来是 650 多个 mesh，每个不透明件还要多挂一层反向外壳描边，
     * 于是一帧 1312 个 draw call —— 核显（Intel UHD 620）实测 60 ms/帧、16.6 fps。
     * 三角形只有 5.4 万面，瓶颈在提交次数，不在画面复杂度，所以按「减少 mesh 数」治：
     *
     *   1) 部件内部合并：一台断路器十几个绝缘子/触头/机构箱，烘成一个带顶点色的 mesh。
     *      颜色写进顶点属性，一个材质还原所有零件，draw call 从「零件数 ×2」降到 2。
     *   2) 布景合并：门型架、支柱、构架、地面这些不参与交互的，全站合成一个。
     *
     * 不变的三件事：点击（射线打到合并 mesh，再向上找 userData.part 的组）、
     * 抽拉（移动的还是那个组）、高亮（换的是描边材质，不碰顶点色）。
     * 透明件（导线、点击代理）不合并 —— 它们靠 opacity 区分用途，合成同一材质会互相污染。 */
    var BAKE_SKIP = /Plane|Circle|Ring|Shape|Sprite|Line|Points/;

    function bakeTo(list, parent, opt) {
      if (list.length < 2) return null;
      parent.updateMatrixWorld(true);
      var inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
      var mtx = new THREE.Matrix4();
      var pos = [], nor = [], col = [], uv = [], hasUv = false;
      list.forEach(function (o) {
        var g = o.geometry;
        if (!g || !g.attributes || !g.attributes.position) return;
        var gg = g.index ? g.toNonIndexed() : g.clone();
        gg.applyMatrix4(mtx.copy(o.matrixWorld).premultiply(inv));
        var p = gg.attributes.position, n = gg.attributes.normal, u = gg.attributes.uv;
        var c = (o.material && o.material.color) || { r: 1, g: 1, b: 1 };
        for (var i = 0; i < p.count; i++) {
          pos.push(p.getX(i), p.getY(i), p.getZ(i));
          if (n) nor.push(n.getX(i), n.getY(i), n.getZ(i)); else nor.push(0, 1, 0);
          if (u) { uv.push(u.getX(i), u.getY(i)); hasUv = true; } else uv.push(0, 0);
          col.push(c.r, c.g, c.b);   /* 顶点色存线性值，toon 材质直接乘，不再做色彩空间转换 */
        }
        gg.dispose();
      });
      if (!pos.length) return null;
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
      if (hasUv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
      geo.computeBoundingSphere();
      var tr = !!(opt && opt.transparent);
      var m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.74, metalness: 0.06,
        transparent: tr, opacity: tr ? (opt.opacity == null ? 0.94 : opt.opacity) : 1
      }));
      parent.add(m);
      return m;
    }

    function bakeable(o) {
      if (!o.isMesh || o.userData.isOutline || o.userData.isLabel) return false;
      if (BAKE_SKIP.test((o.geometry && o.geometry.type) || '')) return false;
      var m = o.material;
      if (!m || Array.isArray(m) || m.transparent) return false;
      return true;
    }

    /* 导线是一堆半透明细圆柱，每条一个 draw call、全站两百多条。
     * 它们同色同透明度，合成一个对画面没有影响（细杆之间几乎不互相遮挡），
     * 但点击代理（opacity 0、Basic 材质）不能混进来 —— 一混就变成看得见的实心盒。 */
    function bakeableWire(o) {
      if (!o.isMesh || o.userData.isOutline || o.userData.isLabel) return false;
      if (BAKE_SKIP.test((o.geometry && o.geometry.type) || '')) return false;
      var m = o.material;
      if (!m || Array.isArray(m) || !m.transparent) return false;
      return m.isMeshStandardMaterial && (m.opacity || 0) > 0.5;
    }

    function collect(root, test) {
      var list = [];
      root.traverse(function (o) { if (test(o)) list.push(o); });
      return list;
    }
    function bakeIn(root, test, opt) {
      var list = collect(root, test);
      if (list.length < 2) return 0;
      if (!bakeTo(list, root, opt)) return 0;
      list.forEach(function (o) { if (o.parent) o.parent.remove(o); });
      bakedFrom += list.length; bakedTo += 1;
      return list.length;
    }

    var bakedFrom = 0, bakedTo = 0;
    /* ① 部件内部：实体件一层，导线一层 */
    parts.forEach(function (g) {
      bakeIn(g, bakeable, null);
      bakeIn(g, bakeableWire, { transparent: true, opacity: 0.94 });
    });
    /* ② 布景（不属于任何部件组的一律收进来） */
    function inPart(o) {
      var p = o.parent;
      while (p && p !== scene) { if (p.userData && p.userData.part) return true; p = p.parent; }
      return false;
    }
    function bakeSceneryType(test, opt) {
      var list = [];
      scene.traverse(function (o) { if (test(o) && !inPart(o)) list.push(o); });
      if (list.length < 2 || !bakeTo(list, scene, opt)) return;
      list.forEach(function (o) { if (o.parent) o.parent.remove(o); });
      bakedFrom += list.length; bakedTo += 1;
    }
    bakeSceneryType(bakeable, null);
    bakeSceneryType(bakeableWire, { transparent: true, opacity: 0.94 });
    scene.updateMatrixWorld(true);
    if (window.VIZ_DEBUG) console.log('[bake] mesh ' + bakedFrom + ' → ' + bakedTo);

    return {
      parts: parts,
      update: update,
      hud: hud,
      narr: narr,
      _extra: extraButtons,
      /* viz.js 的「全景」按钮 / 双击会调到这里：把巡游停掉 */
      resetView: function () {
        run.playing = false;
        run.held = false;
        run.t = 0;
        syncBar();
        syncBtns();
      },
      /* 自测用：跳到巡游的某个时刻并「停住」在那一帧。
       * 早先是直接 playing = true，结果调用完 rAF 立刻把机位往前推，
       * 截出来的构图根本不是这一帧（踩过：以为机位撞柱子，其实是漂移后的过渡帧）。 */
      setTour: function (t) {
        run.cur = 0;
        run.t = Math.max(0, Math.min(curCycle(), t));
        var c = camAt(run.t);
        run.seg = c.seg;
        run.playing = false;
        run.held = true;
        syncBar();
        syncBtns();
        ctx.camera.position.set(c.p[0], c.p[1], c.p[2]);
        ctx.camera.lookAt(c.t[0], c.t[1], c.t[2]);
      },
      cycle: TOURS[0].cycle,
      dispose: function () {
        GLOW.dispose();
        labels.forEach(function (sp) {
          if (sp.material) {
            if (sp.material.map) sp.material.map.dispose();
            sp.material.dispose();
          }
        });
        labels.length = 0;
        ctx.stage.removeEventListener('pointerdown', onGrab);
        ctx.stage.removeEventListener('wheel', onGrab);
      }
    };
  }

  SCENES.substation = {
    title: '110kV 降压变电站',
    /* 整站是全站里最重的一块：合批后仍有 230 多个 draw call。
     * 上限给 1.75（核显那边 viz.js 会先压到 1.5），仍然跑不动就由自适应往下退。 */
    dpr: 1.75,
    /* 这个场景没有拆解，信息卡初始文案必须换一套，否则会显示惰气那块「沿装配方向抽出」 */
    partHint: '点击场景里的设备',
    greeting: '点设备或型号标签，看额定参数与选型依据。',
    camera: { theta: 0.524, phi: 0.955, radius: 53.7, target: [0, 3, -2] },
    build: build,
    extraTitle: '视角',
    extra: function (host, api) {
      if (api && api._extra) api._extra(host, api);
    }
  };
})();
