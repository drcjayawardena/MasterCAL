(() => {
  const $ = id => document.getElementById(id);
  const fields = ['product','facility','bicRate','insurance','stampMode','period','irr'];
  const n = id => Math.max(0, Number($(id).value) || 0);
  const money = value => (Number.isFinite(value) ? value : 0).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
  const pmt = (rate, periods, principal) => {
    if (periods <= 0) return 0;
    if (rate === 0) return principal/periods;
    const factor=Math.pow(1+rate,periods);
    return principal*rate*factor/(factor-1);
  };
  function readBulletRows(period){
    return [...$('bulletRows').querySelectorAll('.bullet-row')].map(row=>{
      const monthInput=row.querySelector('.bullet-month');monthInput.max=String(period);
      const month=Math.max(1,Math.min(period,Math.floor(Number(monthInput.value)||1)));monthInput.value=String(month);
      return {month,amount:Math.max(0,Number(row.querySelector('.bullet-amount').value)||0)};
    }).filter(row=>row.amount>0);
  }
  function calculate(){
    const facility=n('facility'),bicRate=n('bicRate')/100,insurance=n('insurance'),rate=n('irr')/1200;
    const period=Math.max(1,Math.min(72,Math.floor(n('period'))));
    const bic=$('product').value==='AUTO LOANS'&&bicRate===.02?facility*.01:facility*bicRate;
    const stampRates={'REG CAR':.01,'DUAL PURPOSE':.01,'SMALL CAR':.01,'JAPANESE TRUCK / LORRY':0,'INDIAN TRUCK / LORRY':0,'INDIAN MINI TRUCK':.01,'AUTO LOANS':.001};
    const stamp=facility*(stampRates[$('product').value]||0),capitalStamp=$('stampMode').value==='capitalized'?stamp:0;
    const principal=facility+bic+insurance+capitalStamp;
    const bullets=readBulletRows(period),bulletByMonth=Array(period+1).fill(0);
    bullets.forEach(item=>{bulletByMonth[item.month]+=item.amount;});
    const bulletFuture=bulletByMonth.reduce((sum,amount,month)=>sum+(amount?amount*Math.pow(1+rate,period-month):0),0);
    let paymentFactor=0;for(let month=1;month<=period;month++)paymentFactor+=Math.pow(1+rate,period-month);
    const netPayment=bullets.length?Math.max(0,(principal*Math.pow(1+rate,period)-bulletFuture)/(paymentFactor||1)):pmt(rate,period,principal);
    const regular=Math.ceil(netPayment+150),bulletTotal=bulletByMonth.reduce((sum,amount)=>sum+amount,0),totalPaid=regular*period+bulletTotal;
    let balance=principal,totalInterest=0,rows=[];
    for(let month=1;month<=period;month++){
      const opening=balance,interest=opening*rate,rental=regular,capital=Math.max(0,rental-interest),bullet=bulletByMonth[month],closing=Math.max(0,opening-capital-bullet);
      totalInterest+=interest;rows.push({month,opening,rental,interest,capital,bullet,closing,due:rental+bullet});balance=closing;
    }
    $('monthlyRental').textContent=money(regular);
    $('ratePer100k').textContent=money(regular/(facility/100000||1));
    $('totalInterest').textContent=money(Math.max(0,totalPaid-principal));
    $('totalPaid').textContent=money(totalPaid);
    $('amountFinanced').textContent=money(principal);
    $('scheduleRows').innerHTML=rows.map(r=>`<tr><td>${r.month}</td><td>${money(r.opening)}</td><td>${money(r.rental)}</td><td>${money(r.interest)}</td><td>${money(r.capital)}</td><td>${money(r.bullet)}</td><td>${money(r.closing)}</td><td>${money(r.due)}</td></tr>`).join('');
  }
  function updateBulletButton(){const count=$('bulletRows').querySelectorAll('.bullet-row').length;$('addBullet').textContent=count?'ADD ANOTHER BULLET PAYMENT':'ADD BULLET PAYMENT';}
  function addBulletRow(month=Math.ceil(n('period')/2),amount=''){
    const row=document.createElement('div');row.className='bullet-row';
    row.innerHTML=`<label><span>Month</span><input class="bullet-month" type="number" min="1" max="72" step="1" value="${month}"></label><label><span>Amount (LKR)</span><input class="bullet-amount" type="number" min="0" step="1000" value="${amount}" placeholder="Amount"></label><button class="bullet-remove" type="button" aria-label="Remove bullet payment">×</button>`;
    $('bulletRows').appendChild(row);
    row.querySelectorAll('input').forEach(input=>{input.addEventListener('input',calculate);input.addEventListener('change',calculate);});
    row.querySelector('.bullet-remove').addEventListener('click',()=>{row.remove();updateBulletButton();calculate();});
    updateBulletButton();calculate();row.scrollIntoView({behavior:'smooth',block:'nearest'});row.querySelector('.bullet-amount').focus({preventScroll:true});
  }
  fields.forEach(id=>$(id).addEventListener('input',calculate));
  fields.forEach(id=>$(id).addEventListener('change',calculate));
  $('addBullet').addEventListener('click',()=>addBulletRow());
  $('scheduleButton').addEventListener('click',()=>{const open=$('scheduleSection').hidden;$('scheduleSection').hidden=!open;$('scheduleButton').setAttribute('aria-expanded',String(open));$('scheduleButton').textContent=open?'HIDE RENTAL SCHEDULE':'SHOW RENTAL SCHEDULE';if(open)$('scheduleSection').scrollIntoView({behavior:'smooth',block:'start'});});
  $('printButton').addEventListener('click',()=>window.print());
  calculate();
})();
