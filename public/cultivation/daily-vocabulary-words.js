// 原創字卡和題句。分組是本課程的 CEFR 參考難度；陣列順序決定每日輪替。
// 每列：單字 | 詞性 | 本次學習的詞義 | 字卡例句 | 測驗句（{} 為空格）
// 新增詞彙請附在對應級別的末尾，每次加入五個。
const bands = {
  B1: `
afford|v.|負擔得起（費用）|We can afford a short trip if we take the train.|I cannot {} a new laptop on my current salary.
achievement|n.|成就|Finishing the hike was a real achievement for Leo.|Winning the science fair was her proudest {} of the year.
persuade|v.|說服|Mina tried to persuade her parents to adopt a cat.|Can you {} Ben to join the team even though he is nervous?
suitable|adj.|適合的|These shoes are suitable for walking on wet paths.|A story with simple language is more {} for younger readers.
assignment|n.|指定作業|Our next assignment is to interview someone in our neighborhood.|I finished my history {} before dinner so I could go to practice.

campaign|n.|有目標的宣傳活動|The school launched a campaign to reduce food waste.|A local road safety {} reminds drivers to slow down near schools.
expand|v.|擴大|The library plans to expand its collection of graphic novels.|The cafe wants to {} its seating area before the summer.
require|v.|需要|Some plants require more sunlight than others.|The longer route will {} extra time and water.
previous|adj.|先前的|This year's concert was shorter than the previous one.|I used the notes from the {} lesson to finish today's homework.
ambitious|adj.|有企圖心的；有遠大目標的|Ada is an ambitious student who wants to run her own business.|Their most {} plan is to open a shop in every major city within three years.

apologize|v.|道歉|You should apologize for losing the key.|It would be polite to {} for arriving late at the meeting.
ambition|n.|志向；抱負|His childhood ambition was to become a pilot.|My main {} is to design affordable homes for families.
ban|v.|禁止|The school may ban phones during class.|The council voted to {} cars from the square on weekends.
environmental|adj.|環境的；與環境有關的|The committee discussed the environmental cost of the new highway.|Several {} groups have asked the city to protect the wetland.
volunteer|n.|志工|A volunteer showed us where to leave our coats.|As a library {}, Omar helps visitors find books without getting paid.

annoy|v.|惹惱|Loud phone calls can annoy people on a quiet train.|Do not tap your pen during the exam because it may {} your classmates.
attach|v.|附上；固定在……上|Please attach the receipt to this form.|Use the small clips to {} the sign to the fence.
confident|adj.|有信心的|After a week of practice, Amy felt confident on stage.|I am {} that I can finish the race because I trained every day.
challenge|n.|具挑戰性的事|Learning to swim as an adult was a challenge for my uncle.|Completing the puzzle without any clues was a real {}.
admit|v.|承認（錯誤或事實）|Nora decided to admit she had read the map upside down.|It was hard for the goalkeeper to {} that the goal was his fault.

admire|v.|欣賞；敬佩|I admire my aunt for going back to school at fifty.|Many readers {} the author for speaking honestly about her mistakes.
reliable|adj.|可靠的|Our neighbor is a reliable person to ask for help.|We use a {} weather report when planning trips in the mountains.
complex|adj.|複雜的|We drew several diagrams to explain the complex process.|The rules are too {} to explain in a single sentence.
application|n.|申請；申請書|The college received my application on time.|Ned filled out an {} for a library job.
remind|v.|提醒|Please remind me to bring my notebook on Monday.|Could you {} Mia to turn off the lights before she leaves?

advise|v.|建議；勸告|Most guides advise hikers to bring extra water.|The doctor will {} him to rest for at least two days.
convenient|adj.|方便的|A locker beside the entrance is convenient for cyclists.|The station is in a {} location, only two minutes from the hotel.
departure|n.|出發；離開|We arrived only ten minutes before our departure.|Five minutes before {}, the crew closed the train doors.
confirm|v.|確認|The dentist called to confirm my appointment.|Please {} your booking by clicking the link in the email.
equal|adj.|相等的|Divide the clay into three equal pieces.|Add {} amounts of flour and water so the mixture is balanced.

aware|adj.|察覺到的|Most students were aware of the changes to the timetable.|Few people were {} that a small river flowed under the street.
examine|v.|仔細檢查|The vet had to examine the dog's injured leg.|Before replacing the wheel, the mechanic will {} it for cracks.
appointment|n.|約定的會面；預約|I made an appointment to see the dentist on Thursday.|After the meeting, I have a medical {} at the clinic.
ceremony|n.|典禮|The awards ceremony began with a short speech.|Families came to the graduation {} to watch students receive their diplomas.
ignore|v.|不理會|It is easy to ignore an alarm that rings too often.|Do not {} a warning light just because the car still runs.

concentrate|v.|專注|I can concentrate better with my phone in another room.|It was hard to {} on the lecture while people talked outside.
responsible|adj.|負有責任的|I am responsible for feeding the class fish.|Who is {} for checking that the main gate is locked?
disadvantage|n.|不利之處；缺點|A long commute is one disadvantage of living here.|The main {} of this bicycle is that it is difficult to carry upstairs.
generation|n.|世代|My grandmother's generation usually wrote letters by hand.|The youngest {} in our family learned to use phones before they could read.
occasion|n.|特定場合|They saved the handmade cups for a special occasion.|Her graduation was an important {} for the whole family.

generous|adj.|慷慨的|A generous neighbor gave the class a new set of paints.|It was {} of Chris to donate his prize money to the shelter.
familiar|adj.|熟悉的|We took a familiar path home after the concert.|The melody sounded {} because I had heard it every morning as a child.
explore|v.|探索|We plan to explore the old town on foot.|The class will {} how plants grow without sunlight.
treatment|n.|治療|The clinic offers treatment for sports injuries.|The doctor prescribed a different {} after the first medicine failed to help.
conclusion|n.|結論|We reached the same conclusion after comparing the results.|The researchers drew a different {} from the second set of measurements.

rare|adj.|罕見的|A rare bird appeared in the garden this morning.|It is {} to see this flower outside the mountains.
survive|v.|存活；生存下來|These small plants can survive with very little water.|How do bees {} through the coldest months of winter?
substance|n.|物質|The clear substance turned blue when we added water.|The label warns that the white {} inside the jar can burn your skin.
technique|n.|技術；技巧|The baker showed us a useful technique for shaping the dough.|The coach taught a new {} for breathing while swimming.
supply|n.|供應量；儲備|Keep an extra supply of batteries on the boat.|The clinic had a limited {} of clean water after the storm.

accurate|adj.|準確的|We need an accurate map of the hills.|Check the scale twice before giving an {} measurement.
various|adj.|各式各樣的|The shop sells various kinds of tea.|The museum displays tools from {} periods of history.
accommodation|n.|住宿|We found affordable accommodation near the beach.|The scholarship covers travel and {} for the whole week of the conference.
emergency|n.|緊急情況|Keep this number in case of an emergency.|The pilot asked for help when a medical {} occurred on the plane.
promote|v.|促進；推廣|The campaign will promote the use of reusable cups.|The city uses a free bike program to {} healthier travel habits.

consume|v.|消耗|Older heaters often consume more energy.|Running all these machines will {} a large amount of electricity.
determined|adj.|下定決心的|Jun was determined to finish the race despite the heat.|Even after failing twice, she was {} to pass the driving test.
essential|adj.|必不可少的|A supply of clean water is essential on this route.|Accurate measurements are {} if you want the shelves to fit.
discount|n.|折扣|Students receive a discount at this theater.|The seller offered a ten-percent {} if we bought two bags.
exhibition|n.|展覽|The school put on an exhibition of student photographs.|The museum's new {} will display clothes from the nineteenth century.

assist|v.|協助|A librarian offered to assist me with the search.|The nurse will {} the doctor during the examination.
gentle|adj.|輕柔的；溫和的|Use a gentle touch to clean the old photograph.|A {} breeze moved the curtains without knocking anything over.
grateful|adj.|感激的|We were grateful for the ride home after the concert.|I am {} to everyone who helped me find my dog.
reaction|n.|反應|I did not expect such a strong reaction to the announcement.|His first {} to the good news was to laugh.
obvious|adj.|明顯的|The mistake was obvious once we read the original notes.|It was {} which lamp was broken because it was the only one that did not light up.

doubt|v.|懷疑|I doubt we will get to the beach before dark.|The footprints are too small, so I {} that an adult made them.
honest|adj.|誠實的|An honest answer helped us fix the problem.|Be {} about the mistake instead of blaming someone else.
practical|adj.|實用的|The guide offers practical advice for first-time campers.|A bicycle is a {} choice for short trips around the neighborhood.
function|n.|功能；作用|One function of the roots is to hold the plant in place.|The main {} of the lid is to keep dust out of the container.
reservation|n.|預約；訂位|We made a reservation for dinner at seven.|The hotel confirmed our {} for two nights in July.

encourage|v.|鼓勵|The librarian wants to encourage children to read for fun.|Teachers should {} students to ask questions when they are confused.
conclude|v.|得出結論|We cannot conclude anything from a single measurement.|After the second test, the team could {} that the sensor was faulty.
effective|adj.|有效的|A five-minute break can be an effective way to regain focus.|The trial showed the new treatment was {} at reducing pain.
definite|adj.|確定的；明確的|No one has given us a definite date for the move.|We need a {} answer by Monday so we can buy the tickets.
consequence|n.|後果|One consequence of the road closure was a longer commute.|Missing the last train was an unexpected {} of staying at the concert too long.
`,
  B2: `
assess|v.|評估|The coach will assess each player's progress in June.|Before buying the building, engineers must {} the risk of flooding.
distribute|v.|發放；分發|Volunteers distribute maps at the entrance.|The clinic will {} masks to anyone who needs one.
circumstance|n.|情況；條件|Missing a flight is sometimes the result of a circumstance beyond your control.|One unusual {} in this case was that both clocks had stopped at the same time.
coherent|adj.|條理清楚的；連貫的|She turned several unrelated notes into a coherent report.|The editor moved several paragraphs to make the argument more {}.
diverse|adj.|多元的|The island supports a diverse range of birds.|The festival features a {} mix of music from several regions.

acquire|v.|習得；取得|Interns acquire skills while working with experienced staff.|Reading widely helps students {} vocabulary in context.
justify|v.|說明……有正當理由|The manager had to justify the extra spending.|Can the city {} the cost of a tunnel used by so few people?
insight|n.|深入見解|The survey offered insight into how customers choose products.|The diary gives us {} into how people lived during the shortage.
intense|adj.|強烈的|The intense heat kept most people indoors.|After hours under the {} sunlight, the workers took a break in the shade.
ambiguous|adj.|含意不明確的|The instructions were ambiguous, so the two groups interpreted them differently.|The wording is {} enough to support two different readings.

derive|v.|由……得出；源自|Researchers derive their estimates from several data sets.|We can {} an estimate for next year from this year's sales figures.
preserve|v.|保存；保護以免損失|The museum uses special boxes to preserve old letters.|Keeping the area closed to cars will help {} the historic streets.
incentive|n.|誘因|A small discount acted as an incentive to buy a yearly pass.|The city offered a tax credit as an {} for installing solar panels.
controversial|adj.|有爭議的|The proposed parking rules were controversial among shopkeepers.|Closing the old market was a {} decision that divided the town.
capable|adj.|有能力的|The smallest pump is capable of moving fifty liters a minute.|The new team proved it was {} of handling the project alone.

adapt|v.|適應；調整以配合|The actors had to adapt to a much smaller stage.|Schools may need to {} their schedules during periods of extreme heat.
anticipate|v.|預期；預先料到|The organizers anticipate a larger crowd this year.|If we {} delays at the border, we can leave an hour earlier.
implication|n.|可能造成的影響；牽連|The main implication of the policy is higher costs for small shops.|One serious {} of the closure is that patients will need to travel farther.
feasible|adj.|可行的|The team checked whether the plan was feasible within three months.|Building a ramp is {} because there is enough space and funding.
compatible|adj.|相容的|The old charger is not compatible with this device.|Before buying the software, check that it is {} with your computer.

evaluate|v.|評量；評估成效|The library will evaluate the reading program at the end of term.|Teachers will {} the new exercise by comparing student work before and after it.
decline|v.|婉拒|Ravi decided to decline the invitation because he was away.|I appreciated the offer but had to {} it because of a prior commitment.
hypothesis|n.|可驗證的假說|The class designed an experiment to test its hypothesis.|The researchers started with the {} that warmer water would speed up the reaction.
persistent|adj.|持續存在的|A persistent noise came from the broken fan.|The clinic is trying to find the cause of her {} cough.
characteristic|adj.|有代表性的；典型的|The brown spots are characteristic of this species.|The rounded windows are a {} feature of houses from that period.

interpret|v.|解讀|Students interpret the poem in different ways.|Without the original dates, it is difficult to {} these figures correctly.
regulate|v.|對……加以規範|Local rules regulate how late restaurants can play music.|Some cities {} the number of rental scooters on their streets.
phenomenon|n.|現象|The researchers documented a strange weather phenomenon.|The sudden appearance of blue light in the waves is a natural {}.
efficient|adj.|有效率的|The new pump is more efficient than the old one.|Grouping nearby deliveries is an {} way to save time and fuel.
realistic|adj.|切合實際的|Let's set a realistic target for this week.|It seems more {} to finish the report on Thursday than tomorrow morning.

retain|v.|保留|Some materials retain heat long after the oven is turned off.|Keep the receipt if you want to {} proof of the purchase.
acknowledge|v.|承認|The team had to acknowledge that its first estimate was wrong.|The article should {} the limits of the available evidence.
variation|n.|變異；差異|We observed significant variation in the height of the plants.|The east and west coasts show considerable {} in yearly rainfall.
consistent|adj.|一致的|The two witnesses gave consistent accounts of the event.|The lab asks everyone to follow the same steps to get {} results.
aggressive|adj.|具攻擊性的|The dog became aggressive when a stranger grabbed its collar.|Visitors should keep their distance if an animal shows {} behavior.

negotiate|v.|協商|Both sides agreed to negotiate a new contract.|The renters want to {} a lower price before renewing their leases.
recruit|v.|招募|The library needs to recruit more weekend volunteers.|The company plans to {} ten new apprentices this summer.
priority|n.|優先事項|Safety was our first priority on the flooded trail.|Restoring power to the hospital is the city's top {}.
potential|adj.|潛在的|The staff identified several potential problems before the launch.|We toured three {} sites before deciding where to build the clinic.
appropriate|adj.|合宜的；適當的|Choose clothing appropriate for a day of outdoor work.|A quiet room is more {} for the hearing test than a busy hallway.

enhance|v.|增強；改善|Natural light can enhance the appearance of a small room.|Adding sound effects will {} the atmosphere of the play.
exceed|v.|超出|The cost could exceed our original estimate.|If the temperature begins to {} the safe limit, switch off the machine.
capacity|n.|容量；容納上限|The theater has a capacity of one hundred people.|The stadium reached its {} before the final match began.
significant|adj.|顯著的；明顯的|The trial showed a significant improvement in reading speed.|There was a {} drop in traffic after the new train line opened.
comprehensive|adj.|全面的|The guide offers a comprehensive overview of the city's bus system.|We need a {} report covering every stage of the project.

contribute|v.|作出貢獻；出力|Even small gardens can contribute to local biodiversity.|The school invited parents to {} their time and skills to the event.
resolve|v.|解決（問題或紛爭）|Both groups met to resolve their disagreement.|A mediator helped the neighbors {} a dispute over the fence.
commitment|n.|承諾|The director made a commitment to keep the center open.|Their written {} requires them to publish an annual report.
constructive|adj.|有助於改善的；建設性的|She gave constructive feedback on my first draft.|A {} comment explains what can be improved and offers a way forward.
ethical|adj.|合乎倫理的；與倫理有關的|The study raised ethical questions about consent.|The editor faced an {} dilemma about whether to reveal the source's name.

demonstrate|v.|以證據證明；展示|The class will demonstrate how the new sensor works.|The company needs to {} that its filters actually remove the particles.
emphasize|v.|強調|The guide was written to emphasize the importance of preparation.|The teacher drew a box around the rule to {} how important it was.
procedure|n.|程序；步驟|The nurse explained the procedure for checking in.|Read the laboratory {} from start to finish before using the equipment.
deliberate|adj.|蓄意的；經審慎考量的|Changing the design was a deliberate choice.|Leaving the final scene silent was a {} decision by the director.
precise|adj.|精確而明確的|The recipe gives precise instructions for cooling the mixture.|The delivery team needs a {} address instead of just the street name.

detect|v.|偵測；察覺|These sensors can detect very small changes in pressure.|The technician used a special camera to {} heat leaking from the roof.
monitor|v.|持續監測|Park staff monitor the water level after heavy rain.|Researchers will {} each nest every morning through the breeding season.
proportion|n.|比例|A large proportion of the class chose the later time.|The survey measured the {} of households that use public transportation.
industrial|adj.|工業的|The abandoned industrial site was turned into offices.|Most of the city's {} equipment is built in factories near the port.
resistant|adj.|有抵抗力的；耐……的|The new jacket is resistant to water.|The laboratory tested whether these plants are {} to the disease.

conduct|v.|執行；進行|Students will conduct a survey about travel habits.|The city plans to {} a safety inspection before the pool opens.
implement|v.|實施；落實|The library will implement the new borrowing rules in April.|The school needs trained staff to {} its new safety plan.
initiative|n.|主動推動的計畫；倡議|The neighborhood started an initiative to plant more trees.|A new city {} will offer free coding courses to teenagers.
mutual|adj.|雙方共同的；相互的|The two clubs share a mutual interest in birdwatching.|The partners reached a {} agreement to share the cost.
mandatory|adj.|強制規定的|The safety training is mandatory for all new staff.|Wearing a helmet is {} on this construction site.

transmit|v.|傳送（訊號等）|The station will transmit the emergency alert at noon.|Faulty wires may fail to {} the signal to the receivers.
undertake|v.|承擔；著手進行|The group agreed to undertake a review of the recent changes.|The university will {} a detailed study of commuting patterns next year.
participant|n.|參與者|Each participant received a copy of the schedule.|Every {} in the workshop had a chance to ask questions.
conventional|adj.|傳統慣用的|The team chose conventional methods to keep training short.|Instead of using a heat pump, the building still relies on a {} heating system.
equivalent|adj.|等值的；相當的|The two tickets have equivalent value.|One hour of exercise here uses energy {} to that of the longer walk.

alter|v.|改變；修改|Heavy rain may alter the route of the race.|The tailor offered to {} my jacket so it would fit.
contradict|v.|與……相矛盾|The new measurements contradict the original estimate.|These two accounts {} each other about who opened the gate.
guideline|n.|指導原則；準則|The organization issued a guideline on handling complaints.|The lab's safety manual gives a {} for how to store chemicals.
flexible|adj.|可彈性調整的|The course has a flexible schedule for working adults.|We can move the meeting to Friday because the timetable is {}.
identical|adj.|完全相同的|The two rooms have identical floor plans.|The keys look {}, but only one opens the door.
`,
  C1: `
mitigate|v.|減輕（不利影響）|Planting trees can mitigate the effects of extreme heat.|To {} the risk of erosion, the village planted grass along the slope.
scrutinize|v.|仔細審查|The auditors will scrutinize every unusually large payment.|Before signing, a lawyer should {} the wording of each clause.
discrepancy|n.|不一致之處；落差|We found a discrepancy between the receipt and the invoice.|The totals should match, so the accountant investigated the {}.
plausible|adj.|看似合理的|The technician offered a plausible explanation for the noise.|The leak is a {} cause of the pressure drop, but we still need to test it.
nuanced|adj.|能分辨細微差別的；有層次的|The article gives a nuanced account of the debate.|A {} reading of the speech would distinguish criticism from outright rejection.

alleviate|v.|緩解|Extending office hours helped alleviate long waits.|A backup bus service could {} the overcrowding at the station.
consolidate|v.|整併為一體|The library will consolidate its three archives in one building.|The company chose to {} five small teams into a single unit.
precedent|n.|先例|The ruling established a precedent for similar cases.|If we waive that fee today, we may set a {} for future requests.
arbitrary|adj.|武斷的；無明確理由的|The date seemed arbitrary because no criteria were given.|A rule set by drawing a number out of a hat would seem {} to staff.
obsolete|adj.|過時而不再使用的|The change made several pieces of equipment obsolete.|Once the files went digital, the old indexing machine became {}.

articulate|v.|清楚表達|The students could articulate why they preferred the second plan.|The committee struggled to {} its objections in clear language.
curtail|v.|縮減；限制規模|The museum had to curtail its evening programs.|The drought forced the city to {} water use in public gardens.
ambiguity|n.|語意含糊；歧義|Removing the pronoun cleared up the ambiguity in the notice.|The editor fixed the {} by stating exactly who had to pay.
tentative|adj.|暫定的；尚未確定的|We made a tentative plan to meet on Tuesday.|The schedule is still {} until the speakers confirm their times.
rigorous|adj.|嚴謹的；周密的|The engineers conducted rigorous tests before opening the bridge.|The figures were checked twice as part of a {} review.

corroborate|v.|以其他證據證實|A second witness was able to corroborate the account.|Investigators used an independent recording to {} the driver's story.
substantiate|v.|提出充分證據支持|The writer could not substantiate the main claim.|To {} the allegation, the reporter would need documents or firsthand testimony.
premise|n.|論證的前提|Her argument rests on the premise that demand will stay constant.|The committee rejected the conclusion because its basic {} was false.
implicit|adj.|未明說但可推知的；隱含的|There was an implicit agreement to avoid naming the source.|The warning was {}: the letter hinted at consequences without spelling them out.
redundant|adj.|多餘而不必要的|The editor removed several redundant sentences.|With two people already making the same check, a third check was {}.

reconcile|v.|使相容；調和|The planner tried to reconcile the two budget estimates.|We need to {} these conflicting records before we can publish the total.
rectify|v.|糾正（錯誤）|The registrar promised to rectify the mistake in my record.|The supplier recalled the batch to {} the labeling error.
integrity|n.|誠信；正直|The journalist showed integrity by correcting her error in public.|Refusing to hide poor results was a sign of the researcher's {}.
impartial|adj.|公正無偏的|An impartial panel heard both sides of the dispute.|The mediator has no ties to either team and promises to remain {}.
inherent|adj.|本質上就有的；固有的|Some uncertainty is inherent in long-term forecasts.|The report discusses the risks {} in working with incomplete data.

undermine|v.|削弱（信任、權威等）|Repeated delays can undermine trust in the timetable.|Hiding early problems could {} confidence in the entire project.
abdicate|v.|退位；放棄王位|The monarch decided to abdicate and live abroad.|Under intense pressure, the king agreed to {} in favor of his daughter.
ramification|n.|衍生後果|One ramification of the merger was a change to staff benefits.|A possible {} of the new rule is that rural clinics will lose staff.
contentious|adj.|引起激烈爭議的|The committee delayed discussion of the most contentious issue.|The boundary plan remained {} because both towns claimed the land.
pervasive|adj.|普遍存在的；遍及各處的|The report described pervasive distrust of the old system.|A {} smell of smoke reached every room on the floor.

disseminate|v.|廣泛傳播（資訊）|The team will disseminate the findings through free public talks.|The network helps nurses {} new health information to remote villages.
endorse|v.|公開支持；認可|Three groups agreed to endorse the proposal.|The board will formally {} the plan if the safety review is positive.
advocacy|n.|倡議；為某事奔走支持|Years of advocacy led to safer routes for cyclists.|Her {} for accessible public buildings helped change local policy.
strategic|adj.|策略性的；為長期目標考量的|Opening near the railway was a strategic decision.|The port has {} importance because it connects the island to major trade routes.
pragmatic|adj.|務實的|A pragmatic solution was to fix the pipes in sections.|Instead of waiting for perfect equipment, they took a {} approach and used what they had.

differentiate|v.|區分；辨別差異|It can be hard to differentiate the two materials by touch.|The test helps doctors {} between two illnesses with similar symptoms.
attribute|v.|把……歸因於（與 to 搭配）|Doctors attribute most cases in the village to a contaminated well.|Analysts {} the fall in sales to a shortage of stock.
inference|n.|推論所得的結論|The article makes an inference that the data do not fully support.|The jury drew a different {} from the same piece of evidence.
empirical|adj.|以觀察或實驗為基礎的|The article calls for empirical evidence before making recommendations.|The explanation was supported by {} findings from thirty field trials.
credible|adj.|可信的|The witness offered a credible account of the incident.|The editors found a second {} source before publishing the story.

hinder|v.|阻礙|A narrow entrance can hinder wheelchair access.|Misleading instructions may {} progress even when the staff are experienced.
exacerbate|v.|使惡化|Dry winds can exacerbate shortages of water.|Cutting bus service could {} the traffic problem rather than ease it.
deterioration|n.|劣化；惡化|The inspector noticed a gradual deterioration in bridge supports.|The hospital recorded a rapid {} in the patient's condition overnight.
adverse|adj.|不利的；有害的|The crop failed because of adverse weather.|The trial was stopped after several people reported {} effects.
susceptible|adj.|容易受……影響的|Older devices are more susceptible to heat damage.|The trees are especially {} to disease after a long dry season.

defer|v.|延後；推遲|The council voted to defer the decision until January.|We should {} the vote until all members have read the report.
reiterate|v.|重申|The director used her closing remarks to reiterate the deadline.|I want to {} that applications will close at noon, as stated earlier.
stipulation|n.|明訂的條件|The grant came with a stipulation that results be shared publicly.|The tenant can keep a pet under one {}: it must stay out of the common areas.
stringent|adj.|嚴格的|The lab follows stringent rules for storing samples.|The airport introduced more {} checks after the safety review.
robust|adj.|穩健的；經得起考驗的|A robust backup plan kept the system running during the outage.|The result remained {} even when the researchers used different assumptions.

adhere|v.|遵守；堅持（與 to 搭配）|Editors must adhere to the journal's style guide.|Food sellers must {} to the hygiene standards when handling raw meat.
leverage|v.|善用（已有資源）|The center hopes to leverage local expertise to run the workshops.|The team can {} its existing network to reach families more quickly.
provision|n.|條款；規定|The contract contains a provision allowing either side to leave early.|A new {} in the ordinance gives tenants time to respond before eviction.
integral|adj.|不可或缺的（與 to 搭配）|Trust is integral to the success of the project.|Volunteers are {} to the program because they run most of the sessions.
viable|adj.|可行且能維持下去的|Rainwater collection may be a viable option for the village.|The store needs regular customers to remain {} after the subsidy ends.

elicit|v.|引出（反應或資訊）|The teacher used open questions to elicit detailed answers.|The interview was designed to {} honest accounts from former employees.
concede|v.|勉強承認；讓步承認|The manager had to concede that the original schedule was unrealistic.|Even critics {} that the new system is easier to use.
anomaly|n.|異常現象；偏離常態之處|A single anomaly appeared in an otherwise steady record.|The team repeated the tests to see whether the sudden spike was an {}.
conspicuous|adj.|顯眼的；引人注目的|The yellow roof made the building conspicuous from the road.|Her bright red scarf was {} in the crowd of dark uniforms.
profound|adj.|深刻的；影響深遠的|The drought had a profound effect on the local economy.|The invention brought about a {} change in how people traveled and worked.

withhold|v.|保留而不提供|The agency may withhold records containing personal information.|The judge allowed the witness to {} her address for safety reasons.
impede|v.|妨礙；阻滯|Ice on the tracks could impede train service.|Poor lighting can {} efforts to inspect the damaged wiring.
contingency|n.|可能發生、須預先準備的情況|The team set aside supplies for an unexpected contingency.|A power failure is one {} the organizers must plan for.
sporadic|adj.|零星發生的；間歇的|Sporadic showers delayed several outdoor events.|Internet access was {} on the island, with long gaps between brief connections.
negligible|adj.|微小到可忽略的|The change made a negligible difference to the overall cost.|Water loss through the sealed container was so small that it was {}.

delineate|v.|劃定；清楚界定|The agreement will delineate each department's responsibilities.|The map uses a dotted line to {} the boundaries of the protected area.
formulate|v.|擬定；有系統地制定|The team worked together to formulate a response.|After reviewing the feedback, the researchers will {} a new hypothesis.
rationale|n.|某項決定背後的理由|The company explained the rationale for closing early on Fridays.|The board asked for a written {} outlining why the money should be spent on repairs.
quantitative|adj.|量化的；以數量表示的|The researchers collected quantitative data on hours worked.|The report uses {} measures such as sales figures rather than personal impressions.
indicative|adj.|顯示……跡象的（與 of 搭配）|The rise in complaints is indicative of a deeper problem.|Rising water temperatures may be {} of significant changes in the lake.

bolster|v.|增強；鞏固|A busy summer helped bolster the shop's earnings.|The negotiators released more data to {} support for the proposal.
offset|v.|抵銷；彌補|Lower fuel costs helped offset the rise in ticket prices.|Savings on rent could {} part of the cost of moving.
consensus|n.|共識|The delegates could not reach a consensus on the new rules.|After weeks of debate, the panel reached a {} and issued a joint statement.
disproportionate|adj.|不成比例的|A small number of users required a disproportionate amount of support.|The storm caused {} damage in areas that had the fewest resources.
paramount|adj.|最重要的；首要的|Safety is paramount when choosing a crossing point.|The rescue team stressed that keeping everyone warm was of {} importance.
`
};

export const WORDS = Object.entries(bands).flatMap(([band, rows]) =>
  rows.trim().split('\n').filter(Boolean).map(row => {
    const [id, part, meaning, example, cloze] = row.split('|');
    return { id, band, part, meaning, example, cloze };
  })
);
